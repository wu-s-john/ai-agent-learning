# Server Endpoints

## 1. Purpose

This document defines the server API surface for the AI learning system.

The server is intentionally **dumb**:
- it stores canonical data
- it returns filtered and projected data quickly
- it may perform lexical and vector similarity search
- it does not do AI reasoning

That means the server should not:
- grade answers
- diagnose gaps
- infer topic recommendations
- plan quizzes
- explain results in natural language

Those responsibilities belong to the AI agent.

## 2. API Principles

### 2.1 Dumb Server, Smart AI
The server may:
- retrieve topics, questions, quizzes, and activity
- return deterministic projections such as topic profiles and progress summaries
- run full-text and vector search
- filter, rank, paginate, and validate writes

The AI may:
- decide what a learner's gaps are
- decide what questions to ask next
- grade responses
- infer ontology changes
- explain data back to the user

### 2.2 Simple and Flexible Backend
The API should stay small and generic.

Prefer reusable primitives:
- topics
- questions
- quizzes
- quiz items
- responses
- grades
- quiz feedback
- projections

Avoid adding a new endpoint every time the AI can express a new quiz style or workflow. The AI should create variety through prompts and structured outputs; the server should store and retrieve the same generic objects.

For V1, prefer append-only corrections over mutable history. Response drafts are mutable before submission, and review drafts are mutable before finalization. Once a review draft is finalized, grades and learner-model evidence are immutable; later user feedback should be stored as a new event instead of mutating processed records.

### 2.3 HTTP Method Conventions
- `GET` for simple reads
- `POST` for creates and structured read queries with complex bodies
- `PATCH` for metadata updates
- `DELETE` for removing tags or edges

Even when the public endpoint uses `PATCH` or `DELETE`, the implementation can still append an internal audit event or ledger event.

### 2.4 No Smart Workflow Endpoints
These should not exist:
- `POST /api/topics/gaps`
- `GET /api/topics/recommendations`
- `POST /api/topics/recommendations/:id/decision`

Instead, the AI derives those workflows by composing simpler reads:
- topic search
- topic profiles
- topic edges
- activity
- review state
- question history

### 2.5 Semantic Search and Vector Similarity
The server may use vector similarity as part of retrieval.

This is allowed because it is still retrieval, not reasoning.

The recommended pattern is hybrid retrieval:
- exact match
- alias match
- fuzzy lexical match
- full-text search
- tag match
- vector similarity
- deterministic reranking

The server should not interpret the meaning of the result beyond ranking and filtering.

Recommended embedding targets:
- topics:
  - title
  - overview
  - aliases
  - tags
- questions:
  - prompt
  - linked topic titles
  - question tags
  - optional answer-key summary
- references:
  - title
  - path or URL
  - heading
  - snippet
  - chunked body text

Embedding creation workflow:
1. A searchable object is created or updated.
2. The server builds a canonical text string for that object.
3. The server hashes the canonical text plus embedding model.
4. The server tries to create the embedding synchronously through an embedding adapter.
5. If embedding succeeds, the vector row is stored.
6. If embedding fails, the object is still saved and the embedding is marked pending for retry or backfill.

Embeddings are for retrieval only. In V1, embed:
- `topics`
- `questions`
- `reference_chunks`

Do not embed:
- raw learner responses
- review drafts
- grade results
- topic profiles
- activity events

Recommended query flow:
1. Retrieve exact and alias candidates.
2. Retrieve fuzzy lexical candidates.
3. Retrieve full-text candidates.
4. Embed the incoming query text.
5. Retrieve vector-nearest candidates.
6. Merge all candidate sets.
7. Apply deterministic reranking.
8. Return ranked matches with scores and match types.

Recommended response fields:
- `match_type`
  - `exact`
  - `alias`
  - `fuzzy`
  - `keyword`
  - `tag`
  - `vector`
  - `related`
- `score`
- `source`

Suggested implementation with Postgres:
- store embeddings alongside searchable entities or in parallel embedding tables
- use fuzzy matching for titles and aliases
- use a vector index for nearest-neighbor search
- keep the returned shape stable even if the ranking internals change later
- use deterministic fake embeddings in tests
- keep provider, model, and dimension configurable through environment variables

This pattern applies to:
- `GET /api/topics?q=...&limit=...`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `GET /api/references?q=...&limit=...`

### 2.6 Next.js UI Routes and Backing APIs
These are app routes, not server API routes, but they show how the web UI maps onto the API.

| UI route | Purpose | Backing API |
| --- | --- | --- |
| `/quizzes/:quizId/results` | Review draft results or finalized quiz results | `GET /api/quizzes/:quizId/review-draft`, `GET /api/quizzes/:quizId/results` |
| `/quizzes/:quizId/results` | Edit and finalize staged review | `PATCH /api/quizzes/:quizId/review-draft`, `POST /api/quizzes/:quizId/review-draft/finalize` |
| `/quizzes/:quizId/results` | Submit quiz feedback | `POST /api/quizzes/:quizId/feedback` |
| `/topics/:topicId` | Inspect a topic profile | `GET /api/topics/:topicId/profile`, `GET /api/topics/:topicId/edges` |
| `/progress` | Inspect overall learning progress | `GET /api/progress/overview` |
| `/ontology/proposals` | Review inferred ontology and tag proposals | `GET /api/topic-proposals?status=pending`, `POST /api/topic-proposals/:proposalId/decision` |

## 3. Workflow to Endpoint Mapping

### 3.1 Start Quiz
Used by AI workflow:
- `GET /api/topics?q=...&limit=...`
- `POST /api/learner/snapshot`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `POST /api/questions`
- `POST /api/quizzes`

The AI may internally choose a quiz purpose such as mastery check, interview simulation, diagnosis, or learner-model evidence gathering. That purpose affects question selection, difficulty, hinting, and grading posture, but it does not require a separate smart server endpoint.

Main server outputs:
- topic matches
- learner snapshot for the topic neighborhood
- similar existing questions and retrieval signals
- any AI-created questions stored in the reusable question pool
- created quiz metadata
- ordered quiz items for the AI to present locally

### 3.2 Answer Quiz Item
Used by AI workflow:
- `POST /api/quiz-items/:quizItemId/response-draft`

The AI still advances through its local ordered quiz item list, but each answer is saved durably so long quizzes, reloads, or AI restarts do not lose assessment evidence.

When the AI presents a quiz item, it should immediately call the same endpoint with `outcome: "no_answer"` and `answer_text: null`. If the learner answers or skips, that draft is updated.

Main server outputs:
- response draft and item outcome metadata
- quiz status updated to `in_progress`

### 3.3 Submit Quiz Responses
Used when the quiz ends or the learner asks to stop early:
- `POST /api/quizzes/:quizId/responses/submit`
- `POST /api/quizzes/:quizId/review-draft`
- optional visibility: `GET /api/learner-model/updates?status=...&limit=...`

Main server outputs:
- locked submitted response IDs and outcomes plus review payload
- stored review-draft metadata and AI-authored summary fields
- quiz status updated to `review_drafted`

### 3.4 See Quiz Results / Review Draft
Used by AI and Next.js:
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `GET /api/quizzes/:quizId/results`

Main server outputs:
- editable review form payload when the quiz is in draft review state
- saved review draft metadata
- finalized result payload when the quiz has been finalized

### 3.5 Finalize Quiz Review
Used by Next.js results UI:
- `POST /api/quizzes/:quizId/review-draft/finalize`
- `GET /api/quizzes/:quizId/results`

Main server outputs:
- immutable grade IDs and deterministic learner-model update metadata
- results-ready status for the quiz
- finalized quiz results with overview, ratings, item feedback, and topic deltas

### 3.6 Explain Back
Same core endpoints as quizzes and answers:
- `GET /api/topics?q=...&limit=...`
- `POST /api/learner/snapshot`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `POST /api/questions`
- `POST /api/quizzes`
- `POST /api/quiz-items/:quizItemId/response-draft`
- `POST /api/quizzes/:quizId/responses/submit`
- `POST /api/quizzes/:quizId/review-draft`
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `POST /api/quizzes/:quizId/review-draft/finalize`

Main server outputs:
- topic matches and learner snapshot
- created quiz containing `explain_back` items
- response draft metadata, submitted response metadata, review draft metadata, immutable grade metadata, and deterministic learner-model update metadata

### 3.7 Inspect Topic
Primary model-inspection workflow.

Used by AI and Next.js:
- `GET /api/topics?q=...&limit=...`
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`

Main server outputs:
- topic matches
- learner-facing topic profile
- graph neighbors and edge types

### 3.8 Find Gaps
No dedicated smart endpoint.

The AI derives gaps using:
- `GET /api/topics?q=...&limit=...`
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`
- `GET /api/activity?topic_id=...&limit=...`
- `GET /api/review-items?topic_id=...&limit=...`
- `GET /api/questions?q=...&topic_id=...&limit=...`

Main server outputs:
- topic matches for the requested area
- topic profiles for main and neighboring topics
- activity history, review items, and question history

The server does not return a gap diagnosis directly.

### 3.9 Inspect Learning Progress
Primary model-inspection workflow.

Used by AI and Next.js:
- `GET /api/progress/overview`

Main server outputs:
- a deterministic progress summary with strongest, weakest, underexplored, and most reviewed topics

### 3.10 Submit Quiz Feedback
Used by Next.js results UI and AI:
- `POST /api/quizzes/:quizId/feedback`

Main server outputs:
- stored feedback metadata
- appended feedback event metadata

### 3.11 Reference Lookup
Secondary support workflow. This can be delayed until after the core quiz, topic-profile, and progress-inspection surfaces are strong.

Used by AI:
- `GET /api/references?q=...&limit=...`

Main server outputs:
- ranked reference matches with titles, snippets, and source locations

### 3.12 Infer Ontology Recommendations
No dedicated smart endpoint.

The AI derives recommendations using:
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`
- `GET /api/activity?topic_id=...&limit=...`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `GET /api/quizzes?topic_id=...&limit=...`

If proposal persistence is desired:
- `POST /api/topic-proposals`
- `GET /api/topic-proposals?status=pending`
- `POST /api/topic-proposals/:proposalId/decision`

Main server outputs:
- topic profiles, graph edges, question history, and activity for the AI to interpret
- optionally, stored proposal records for pending review

The server does not return ontology recommendations directly.

### 3.13 Curate Ontology Graph
Used by AI and Next.js:
- `POST /api/topics`
- `PATCH /api/topics/:topicId`
- `POST /api/topics/:topicId/tags`
- `DELETE /api/topics/:topicId/tags/:tag`
- `POST /api/topic-edges`
- `DELETE /api/topic-edges/:edgeId`

Main server outputs:
- created or updated topic metadata
- updated tags
- created or deleted edge records

## 4. Endpoint Catalog

## 4.1 Topics

### `GET /api/topics?q=...&limit=...`
Search topics by:
- exact title or alias match
- fuzzy title or alias match
- full-text match
- tag match
- vector similarity

Notes:
- hybrid lexical + vector retrieval is allowed here
- this is retrieval-smart, not reasoning-smart

Example response:
```json
{
  "matches": [
    {
      "topic_id": "compactness",
      "title": "Compactness",
      "tags": ["math", "topology"],
      "match_type": "exact",
      "score": 0.98
    }
  ],
  "resolved": true
}
```

### `GET /api/topics/:topicId`
Return base topic metadata.

### `POST /api/topics`
Create a new topic.

Example request:
```json
{
  "topic_id": "quorums",
  "title": "Quorums",
  "tags": ["distributed-systems", "consensus"],
  "overview": "Basic quorum reasoning for replicated systems."
}
```

### `PATCH /api/topics/:topicId`
Update topic metadata such as:
- title
- overview
- aliases

## 4.2 Topic Tags

### `POST /api/topics/:topicId/tags`
Add one or more tags to a topic.

Example request:
```json
{
  "tags": ["zk", "proof-systems"]
}
```

### `DELETE /api/topics/:topicId/tags/:tag`
Remove a tag from a topic.

## 4.3 Topic Edges

### `GET /api/topics/:topicId/edges`
Return neighboring edges for a topic.

Suggested filters:
- `edge_types`
- `direction`

Example:
`GET /api/topics/raft/edges?edge_types=prereq_of,part_of,related_to`

### `POST /api/topic-edges`
Create a graph edge.

Example request:
```json
{
  "from_topic_id": "quorums",
  "to_topic_id": "raft",
  "edge_type": "prereq_of"
}
```

### `DELETE /api/topic-edges/:edgeId`
Delete an existing edge.

## 4.4 Topic Profiles and Learner Views

### `GET /api/topics/:topicId/profile`
Return the learner-facing topic profile projection.

Example response:
```json
{
  "topic_id": "compactness",
  "title": "Compactness",
  "tags": ["math", "topology"],
  "overview": "Partial intuition, weak formal articulation.",
  "knowledge_score": 0.32,
  "coverage_score": 0.61,
  "strengths": ["Recognizes compactness as a global property"],
  "weaknesses": ["Cannot define compactness cleanly via open covers"],
  "active_misconceptions": ["over-relies on closed-and-bounded intuition"],
  "recent_quizzes": ["Explain-back: weak open-cover definition"],
  "last_reviewed_at": "2026-04-25T20:05:00Z",
  "evidence_count": 5,
  "next_recommended_topics": ["open_covers", "finite_subcovers"]
}
```

### `POST /api/learner/snapshot`
Structured read endpoint for a topic neighborhood.

Use when the AI wants:
- topic profiles for many topics at once
- related topics included
- prerequisite topics included

Example request:
```json
{
  "topic_ids": ["topology", "open_sets", "compactness"],
  "include_related": true,
  "include_prereqs": true,
  "limit_per_bucket": 10
}
```

Example response:
```json
{
  "topics": [
    {
      "topic_id": "compactness",
      "title": "Compactness",
      "tags": ["math", "topology"],
      "overview": "Partial intuition, weak formal articulation.",
      "knowledge_score": 0.32,
      "coverage_score": 0.61,
      "strengths": ["Recognizes compactness as a global property"],
      "weaknesses": ["Cannot define compactness cleanly via open covers"],
      "active_misconceptions": ["over-relies on closed-and-bounded intuition"],
      "last_reviewed_at": "2026-04-25T20:05:00Z",
      "evidence_count": 5
    }
  ],
  "related_topics": [
    {
      "topic_id": "open_covers",
      "title": "Open Covers",
      "edge_type": "prereq_of",
      "knowledge_score": 0.41,
      "coverage_score": 0.52
    }
  ],
  "recent_activity": [
    {
      "quiz_id": "quiz_001",
      "quiz_item_id": "qi_002",
      "topic_ids": ["compactness"],
      "outcome": "answered",
      "review_rating": "Hard",
      "created_at": "2026-04-25T20:05:00Z"
    }
  ],
  "review_items": [
    {
      "question_id": "q_compact_2",
      "topic_ids": ["compactness", "open_covers"],
      "question_tags": ["definition", "open-cover"],
      "due_at": "2026-04-28T18:00:00Z",
      "last_rating": "Hard"
    }
  ]
}
```

This response is raw learner state. It must not include AI-inferred fields like `weak_topics` or `recommended_targets`; the AI derives those from the returned profiles, activity, graph neighbors, and review state.

## 4.5 Questions

### `GET /api/questions?q=...&topic_id=...&limit=...`
Return questions filtered by:
- semantic query text
- topic
- modality
- status
- question tags
- difficulty target
- due/review state

`topic_id` should match through the many-to-many `question_topics` relationship. A single question may belong to multiple topics.

Use this before creating new questions. This is the canonical quiz-planning retrieval endpoint. The server may use hybrid lexical and vector retrieval to return similar existing questions; the AI then decides whether a new disjoint question is needed.

Question tags are flexible retrieval and quiz-planning labels such as `definition`, `proof`, `interview`, `diagnostic`, or `open-cover`. They are not ontology edges.

Retrieval metadata is computed at query time. It explains why a question was returned for this specific query; it is not learner-model evidence and must not update mastery scores.

Example query:
```json
{
  "q": "open cover compactness",
  "topic_id": "compactness",
  "tag": "definition",
  "difficulty_target": 0.6,
  "include_due": true,
  "limit": 30
}
```

Example response:
```json
{
  "questions": [
    {
      "question_id": "q_compact_2",
      "topic_ids": ["compactness", "open_covers"],
      "question_tags": ["definition", "open-cover"],
      "modality": "free_response",
      "difficulty": 0.58,
      "quality_score": 0.91,
      "status": "active",
      "match_type": "vector",
      "score": 0.87,
      "retrieval_score": 0.87,
      "due": true,
      "due_at": "2026-04-28T18:00:00Z",
      "last_rating": "Hard",
      "retrieval_signals": {
        "topic_match": true,
        "tag_overlap": 1,
        "difficulty_distance": 0.02,
        "quality_score": 0.91,
        "due_bonus_applied": true
      }
    }
  ]
}
```

### `GET /api/questions/:questionId`
Return one question definition.

### `POST /api/questions`
Create a reusable question in the pool.

AI-created questions use the same endpoint and status values as any other question. There is no separate generated-question approval lifecycle in V1; if a question later proves confusing or low quality, quiz feedback can lead to editing or retiring it.

V1 questions do not store rubrics. The AI grades using the question prompt, modality, linked topics, question tags, optional answer key, learner response, and its own domain knowledge.

Example request:
```json
{
  "topic_ids": ["compactness", "open_covers"],
  "question_tags": ["definition", "conceptual", "diagnostic"],
  "modality": "free_response",
  "status": "active",
  "prompt": "Explain why the open-cover definition of compactness is not the same as closed and bounded in every topological space.",
  "answer_key": null
}
```

Example response:
```json
{
  "question_id": "q_gen_001",
  "status": "active",
  "created": true
}
```

### `PATCH /api/questions/:questionId`
Update question metadata or status.

Examples:
- fix wording
- retire a bad question
- update difficulty
- update question tags

### `POST /api/questions/:questionId/tags`
Add one or more tags to a question.

Example request:
```json
{
  "tags": ["definition", "interview"]
}
```

### `DELETE /api/questions/:questionId/tags/:tag`
Remove a tag from a question.

## 4.6 Quizzes

### `POST /api/quizzes`
Create a quiz from an AI-authored `QuizPlan`.

The `QuizPlan` may be designed for mastery, interview simulation, diagnosis, or learner-model evidence gathering. The AI creates variety through prompting, difficulty selection, modality choice, and grading posture. The server does not need to reason about that purpose; it stores the generic quiz structure and returns ordered quiz items.

Every quiz item must reference a real question-pool row. If the AI needs a custom question, it should call `POST /api/questions` first and then include the returned `question_id` in `question_refs`.

Optional assessment context fields:
- `purpose`
- `grading_posture`
- `difficulty_target`
- `hint_policy`
- `time_pressure`
- `answer_reveal_policy`

These fields are stored as metadata. They help later review and interpretation, but the server should not infer quiz behavior from them.

`answer_reveal_policy` controls chat disclosure behavior:
- `after_each_item`: the AI may reveal correctness or feedback after each item
- `after_quiz`: the AI should wait until the quiz is submitted or reviewed
- `never_in_chat`: the AI should keep answers and feedback out of chat and rely on the review/results UI

Example request:
```json
{
  "quiz_type": "standard",
  "topic_ids": ["topology"],
  "mode": "mixed",
  "purpose": "diagnosis",
  "grading_posture": "strict",
  "difficulty_target": 0.65,
  "hint_policy": "no_hints",
  "answer_reveal_policy": "after_quiz",
  "time_pressure": null,
  "question_refs": [
    { "question_id": "q_compact_2", "order": 1 },
    { "question_id": "q_gen_001", "order": 2 }
  ]
}
```

Example response:
```json
{
  "quiz_id": "quiz_001",
  "purpose": "diagnosis",
  "grading_posture": "strict",
  "difficulty_target": 0.65,
  "hint_policy": "no_hints",
  "answer_reveal_policy": "after_quiz",
  "time_pressure": null,
  "item_count": 4,
  "items": [
    {
      "quiz_item_id": "qi_001",
      "question_id": "q_compact_2",
      "modality": "free_response",
      "prompt": "State the definition of compactness using open covers.",
      "question_tags": ["definition", "open-cover"]
    }
  ]
}
```

### `GET /api/quizzes/:quizId`
Return base quiz metadata.

V1 quiz statuses:
- `created`
- `in_progress`
- `responses_submitted`
- `review_drafted`
- `finalized`

Example response:
```json
{
  "quiz_id": "quiz_001",
  "quiz_type": "standard",
  "topic_ids": ["topology"],
  "mode": "mixed",
  "purpose": "diagnosis",
  "grading_posture": "strict",
  "difficulty_target": 0.65,
  "hint_policy": "no_hints",
  "answer_reveal_policy": "after_quiz",
  "time_pressure": null,
  "status": "in_progress",
  "item_count": 4,
  "created_at": "2026-04-26T18:00:00Z"
}
```

### `GET /api/quizzes/:quizId/items`
Return the ordered quiz items for a quiz.

This is useful for UI reloads or resuming a quiz if the AI does not already have the item list in context.

Example response:
```json
{
  "quiz_id": "quiz_001",
  "items": [
    {
      "quiz_item_id": "qi_001",
      "question_id": "q_compact_2",
      "order": 1,
      "modality": "free_response",
      "prompt": "State the definition of compactness using open covers.",
      "topic_ids": ["compactness", "open_covers"],
      "question_tags": ["definition", "open-cover"],
      "outcome": "answered",
      "response_state": "draft"
    },
    {
      "quiz_item_id": "qi_002",
      "question_id": "q_open_1",
      "order": 2,
      "modality": "mcq",
      "prompt": "Which of the following sets is open?",
      "topic_ids": ["open_sets"],
      "question_tags": ["mcq", "definition"],
      "outcome": null,
      "response_state": null
    }
  ]
}
```

### `GET /api/quizzes?topic_id=...&limit=...`
Return prior quizzes for a topic or scope.

### `GET /api/quizzes/:quizId/results`
Return full review results for a quiz after the review draft is finalized.

If the quiz status is still `created`, `in_progress`, `responses_submitted`, or `review_drafted`, return a not-ready response instead of partial results.

The Next.js results page should call this endpoint only for finalized results. If the quiz is still in `review_drafted`, the same page should call `GET /api/quizzes/:quizId/review-draft` instead.

Top-level summary fields such as `overview`, `strengths`, `weaknesses`, and `improvement_targets` come from the finalized review draft. Deterministic counts, topic deltas, outcomes, and grade metadata come from stored finalized records.

Example response:
```json
{
  "quiz_id": "quiz_001",
  "status": "finalized",
  "results_ready": true,
  "overview": "You did well on open sets and compactness, but bases are still incomplete.",
  "strengths": [
    "Good recall on open-set recognition",
    "Strong formal compactness definition"
  ],
  "weaknesses": [
    "Basis definitions need more precision"
  ],
  "improvement_targets": [
    "basis_for_topology",
    "open_covers"
  ],
  "rating_counts": {
    "Again": 0,
    "Hard": 1,
    "Good": 2,
    "Easy": 0
  },
  "items": [
    {
      "quiz_item_id": "qi_003",
      "outcome": "answered",
      "feedback": "Partially correct, but incomplete.",
      "review_rating": "Hard"
    }
  ]
}
```

## 4.7 Quiz Items

### `GET /api/quiz-items/:quizItemId`
Return one concrete quiz item with prompt snapshot and metadata.

Example response:
```json
{
  "quiz_item_id": "qi_002",
  "quiz_id": "quiz_001",
  "question_id": "q_compact_2",
  "order": 2,
  "prompt": "State the definition of compactness using open covers.",
  "modality": "free_response",
  "topic_ids": ["compactness", "open_covers"],
  "question_tags": ["definition", "open-cover"],
  "answer_key": null,
  "outcome": "answered",
  "response_id": "resp_002",
  "response_state": "draft"
}
```

## 4.8 Quiz Feedback

### `POST /api/quizzes/:quizId/feedback`
Store learner feedback about a results-ready quiz.

Quiz feedback is additive. It does not mutate submitted responses, stored grades, or already-processed learner-model projections.

Example request:
```json
{
  "feedback_text": "Question 3 felt ambiguous because it did not specify the topology.",
  "quiz_item_id": "qi_003",
  "feedback_type": "question_quality"
}
```

Example response:
```json
{
  "feedback_id": "qfb_001",
  "event_id": "evt_3001",
  "recorded": true
}
```

## 4.9 Responses

### `POST /api/quiz-items/:quizItemId/response-draft`
Save or update the learner's draft response and outcome for one quiz item.

This is the preferred path during live chat quizzes. The AI can still keep conversational context, but the raw answer is saved durably so reloads, long quizzes, or AI restarts do not lose assessment evidence.

This endpoint does not grade, submit, or update the learner model. Draft responses remain editable until the quiz responses are submitted.

The request may also include `answer_reveal_policy` if the learner changes their chat preference mid-quiz. The server stores or echoes the effective policy, but the AI is responsible for honoring it in chat.

Allowed `outcome` values:
- `answered`
- `skipped`
- `no_answer`
- `timed_out`
- `abandoned`
- `excluded`

Example shown-but-unanswered request:
```json
{
  "outcome": "no_answer",
  "answer_text": null,
  "image_refs": [],
  "submitted_from": "chat",
  "answer_reveal_policy": "after_quiz"
}
```

The AI should send this when it presents a quiz item. If the learner later answers, skips, times out, or abandons the item, the AI updates the same draft through this endpoint. Quiz items that were never shown should remain outcome-less.

Example answered request:
```json
{
  "outcome": "answered",
  "answer_text": "A space is compact if every open cover has a finite subcover.",
  "image_refs": [],
  "submitted_from": "chat",
  "answer_reveal_policy": "after_quiz"
}
```

Example response:
```json
{
  "response_id": "resp_002",
  "quiz_id": "quiz_001",
  "quiz_item_id": "qi_002",
  "outcome": "answered",
  "response_state": "draft",
  "answer_reveal_policy": "after_quiz",
  "quiz_status": "in_progress"
}
```

Example skipped-item request:
```json
{
  "outcome": "skipped",
  "answer_text": null,
  "image_refs": [],
  "submitted_from": "chat"
}
```

### `POST /api/quizzes/:quizId/responses/submit`
Submit all saved response drafts and item outcomes for a quiz.

This endpoint is called when the quiz ends naturally or the learner asks to end early. It atomically locks saved outcomes for presented items, marks the quiz `responses_submitted`, and returns the minimal review payload the AI needs to create a review draft.

It does not create immutable grades and does not update the learner model.

Retries should use the same `idempotency_key`; the server should return the same response IDs instead of creating duplicate submissions.

Example request:
```json
{
  "idempotency_key": "quiz_001_submit_responses_001",
  "submitted_from": "chat"
}
```

Example response:
```json
{
  "quiz_id": "quiz_001",
  "status": "responses_submitted",
  "responses": [
    {
      "quiz_item_id": "qi_001",
      "response_id": "resp_001",
      "outcome": "skipped",
      "response_state": "submitted"
    },
    {
      "quiz_item_id": "qi_002",
      "response_id": "resp_002",
      "outcome": "answered",
      "response_state": "submitted"
    }
  ],
  "review_payload": [
    {
      "response_id": "resp_001",
      "quiz_item_id": "qi_001",
      "question": {
        "question_id": "q_open_1",
        "topic_ids": ["open_sets"],
        "modality": "mcq",
        "prompt": "Which of the following sets is open?"
      },
      "response": {
        "outcome": "skipped",
        "answer_text": null
      }
    },
    {
      "response_id": "resp_002",
      "quiz_item_id": "qi_002",
      "question": {
        "question_id": "q_compact_2",
        "topic_ids": ["compactness"],
        "modality": "free_response",
        "prompt": "State the definition of compactness using open covers.",
        "question_tags": ["definition", "topology"],
        "answer_key": null
      },
      "response": {
        "outcome": "answered",
        "answer_text": "A space is compact if every open cover has a finite subcover."
      }
    }
  ]
}
```

### `GET /api/responses/:responseId`
Return one response with its question snapshot.

This is useful for debugging, review UI drill-downs, or AI recovery if it needs to reconstruct review context. The normal quiz submission flow receives this data from `POST /api/quizzes/:quizId/responses/submit`.

Suggested fields:
- response
- question
- question tags or answer key
- modality
- response state
- outcome

Example response:
```json
{
  "response_id": "resp_001",
  "quiz_id": "quiz_001",
  "quiz_item_id": "qi_002",
  "question": {
    "question_id": "q_compact_2",
    "topic_ids": ["compactness"],
    "question_tags": ["definition", "topology"],
    "modality": "free_response",
    "prompt": "State the definition of compactness using open covers.",
    "answer_key": null
  },
  "response": {
    "outcome": "answered",
    "answer_text": "A space is compact if every open cover has a finite subcover.",
    "response_state": "submitted"
  }
}
```

### `GET /api/responses/:responseId/grades`
Return immutable finalized grades for the response.

If the review draft has not been finalized yet, this may return an empty list.

## 4.10 Review Drafts and Final Grades

Canonical review evidence fields:
- `review_rating`: `Again`, `Hard`, `Good`, or `Easy`
- `evidence_score`: overall evaluation confidence, from `0` to `1`
- `topic_evidence[].topic_id`: existing topic ID
- `topic_evidence[].evidence_strength`: evidence for current knowledge, from `0` to `1`
- `topic_evidence[].coverage_signal`: amount of topic coverage explored by this item, from `0` to `1`
- `excluded`: whether the item should be ignored by learner-model projections
- `needs_ai_re_review`: whether learner dispute requires a revised AI review before finalization

### `POST /api/quizzes/:quizId/review-draft`
Create or replace the mutable review draft for submitted quiz responses.

This is where the AI stores proposed feedback, proposed ratings, misconceptions, and topic evidence after reviewing submitted responses. It is staging only.

This endpoint must not create immutable grades and must not update the learner model.

Evidence may target any existing topic, even if the topic was not originally linked to the question. This endpoint must not auto-create topics.

The AI should not submit canonical `knowledge_delta` or `coverage_delta` values. It should submit review evidence. Final learner-model updates are computed deterministically when the review draft is finalized.

Retries should use the same `idempotency_key`; the server should return the same result for the same body and reject conflicting retries.

Example request:
```json
{
  "idempotency_key": "quiz_001_review_draft_001",
  "summary": {
    "overview": "Strong compactness definition, but basis definitions need more precision.",
    "strengths": ["Correct formal definition"],
    "weaknesses": ["Needs more precision around basis definitions"],
    "improvement_targets": ["basis_for_topology", "open_covers"]
  },
  "items": [
    {
      "response_id": "resp_002",
      "outcome": "answered",
      "overall_feedback": "Good definition. You captured both open covers and finite subcovers.",
      "review_rating": "Good",
      "evidence_score": 0.82,
      "strengths": ["Correct formal definition"],
      "weaknesses": [],
      "misconceptions": [],
      "topic_evidence": [
        {
          "topic_id": "compactness",
          "evidence_strength": 0.82,
          "coverage_signal": 0.35
        },
        {
          "topic_id": "open_covers",
          "evidence_strength": 0.76,
          "coverage_signal": 0.25
        }
      ],
      "excluded": false,
      "needs_ai_re_review": false
    }
  ]
}
```

Example response:
```json
{
  "quiz_id": "quiz_001",
  "review_draft_id": "rd_001",
  "status": "review_drafted",
  "item_count": 1
}
```

### `GET /api/quizzes/:quizId/review-draft`
Return the editable review draft form for a quiz.

This powers the draft state of the Next.js quiz results page where the learner can inspect questions, responses, AI feedback, proposed ratings, misconceptions, and topic evidence before finalization.

Example response:
```json
{
  "quiz_id": "quiz_001",
  "review_draft_id": "rd_001",
  "status": "review_drafted",
  "summary": {
    "overview": "Strong compactness definition, but basis definitions need more precision.",
    "strengths": ["Correct formal definition"],
    "weaknesses": ["Needs more precision around basis definitions"],
    "improvement_targets": ["basis_for_topology", "open_covers"]
  },
  "items": [
    {
      "review_draft_item_id": "rdi_002",
      "quiz_item_id": "qi_002",
      "response_id": "resp_002",
      "outcome": "answered",
      "prompt": "State the definition of compactness using open covers.",
      "answer_text": "A space is compact if every open cover has a finite subcover.",
      "overall_feedback": "Good definition. You captured both open covers and finite subcovers.",
      "review_rating": "Good",
      "evidence_score": 0.82,
      "topic_evidence": [
        {
          "topic_id": "compactness",
          "evidence_strength": 0.82,
          "coverage_signal": 0.35
        }
      ],
      "excluded": false,
      "needs_ai_re_review": false
    }
  ]
}
```

### `PATCH /api/quizzes/:quizId/review-draft`
Save learner edits to the review draft before finalization.

Learner-originated edits can update display feedback, add notes, add dispute reasons, or exclude invalid items. They must not directly update `review_rating`, `evidence_score`, or `topic_evidence`; changing those fields requires AI re-review before finalization. The endpoint must reject edits after the review draft has been finalized.

Example request:
```json
{
  "items": [
    {
      "review_draft_item_id": "rdi_002",
      "overall_feedback": "Correct definition; keep practicing examples and non-examples.",
      "learner_note": "The feedback is fair, but I want a harder follow-up.",
      "dispute_reason": null,
      "excluded": false
    }
  ]
}
```

Example response:
```json
{
  "quiz_id": "quiz_001",
  "review_draft_id": "rd_001",
  "status": "review_drafted",
  "saved": true,
  "needs_ai_re_review": false
}
```

### `POST /api/quizzes/:quizId/review-draft/finalize`
Finalize the staged review draft.

This is the only endpoint that turns staged review evidence into immutable grade results and learner-model updates. It should atomically:
- validate that all referenced responses are submitted
- reject finalization if any non-excluded item has `needs_ai_re_review: true`
- create immutable `grade_results`
- create topic evidence rows from the final review draft
- compute learner-model updates using deterministic projection rules
- update per-user review state
- mark the quiz `finalized`

The AI should not submit canonical `knowledge_delta` or `coverage_delta` values. The server computes those updates from finalized review evidence using stable projection rules, such as:
- `coverage_signal` with a small per-item cap for `coverage_score`
- `review_rating` plus `evidence_strength` for a bounded knowledge observation
- fixed rating anchors such as `Again = 0.15`, `Hard = 0.45`, `Good = 0.75`, and `Easy = 0.9`
- no learner-model updates for review draft items marked `excluded`

After this endpoint succeeds, grades and finalized evidence cannot be updated. Later corrections must be stored as quiz feedback or handled by a future additive correction workflow.

Example request:
```json
{
  "idempotency_key": "quiz_001_finalize_review_001"
}
```

Example response:
```json
{
  "quiz_id": "quiz_001",
  "status": "finalized",
  "grade_results": [
    {
      "response_id": "resp_002",
      "grade_id": "grade_002",
      "outcome": "answered",
      "excluded": false
    }
  ],
  "learner_model_updates": [
    {
      "topic_id": "compactness",
      "update_id": "lmu_001",
      "applied": true
    }
  ],
  "results_ready": true
}
```

## 4.11 Learner Model Status, Review State, and Activity

### `GET /api/learner-model/updates?status=...&limit=...`
Return learner-model update records for visibility and debugging.

This endpoint is read-only. It does not process updates. In V1, normal quiz processing happens when `POST /api/quizzes/:quizId/review-draft/finalize` succeeds.

Example response:
```json
{
  "updates": [
    {
      "update_id": "lmu_001",
      "quiz_id": "quiz_001",
      "status": "applied",
      "topic_ids": ["compactness"],
      "created_at": "2026-04-26T18:00:00Z",
      "applied_at": "2026-04-26T18:00:03Z"
    }
  ]
}
```

### `GET /api/review-items?topic_id=...&limit=...`
Return due or nearly due items from per-user review state.

This is how the AI can silently bias quizzes toward what should resurface next.

Example response:
```json
{
  "items": [
    {
      "question_id": "q_sumcheck_round_1",
      "topic_ids": ["sumcheck"],
      "question_tags": ["round-invariant"],
      "due_at": "2026-04-26T18:00:00Z",
      "last_rating": "Hard"
    }
  ]
}
```

### `GET /api/activity?topic_id=...&limit=...`
Return recent learner activity for a topic scope.

This can include:
- responses
- grades
- quiz feedback events
- question tag history

Example response:
```json
{
  "items": [
    {
      "question_id": "q_raft_safety_1",
      "question_tags": ["safety", "free-response"],
      "review_rating": "Again",
      "created_at": "2026-04-24T21:00:00Z"
    }
  ]
}
```

## 4.12 Progress

### `GET /api/progress/overview`
Return a deterministic dashboard projection.

Suggested fields:
- strongest topics
- weakest topics
- underexplored topics
- most reviewed topics
- recent misconceptions

Example response:
```json
{
  "global_overview": "Strongest in cryptography. Weaker in topology and compiler backend topics.",
  "strongest_topics": [
    {
      "topic_id": "hash_functions",
      "knowledge_score": 0.88,
      "coverage_score": 0.84
    }
  ],
  "weakest_topics": [
    {
      "topic_id": "compactness",
      "knowledge_score": 0.22,
      "coverage_score": 0.78
    }
  ],
  "recent_misconceptions": [
    "mixes round invariant with final check"
  ]
}
```

## 4.13 References

### `GET /api/references?q=...&limit=...`
Search saved notes or references using lexical and vector retrieval.

This endpoint is for retrieval only. The AI decides how to use the returned references.

Example response:
```json
{
  "results": [
    {
      "source_id": "src_44",
      "title": "Polynomial commitments notes",
      "snippet": "KZG and FRI differ in setup and proof size...",
      "path_or_url": "~/sync-files/learning/topic-notes/polynomial-commitments.md"
    }
  ]
}
```

## 4.14 Optional Topic Proposal Persistence

These endpoints are optional. Use them only if ontology recommendations should appear as pending review objects in Next.js.

### `POST /api/topic-proposals`
Store an AI-authored ontology proposal.

Proposal types may include:
- add topic
- modify topic
- add tag
- remove tag
- add edge
- remove edge

Example response:
```json
{
  "proposal_id": "prop_001",
  "saved": true
}
```

### `GET /api/topic-proposals?status=pending`
Return pending ontology proposals for manual review.

Example response:
```json
{
  "proposals": [
    {
      "proposal_id": "prop_001",
      "proposal_type": "add_topic",
      "topic": {
        "topic_id": "quorums",
        "title": "Quorums"
      },
      "reason": "Repeated blocker in raft-related question families"
    }
  ]
}
```

### `POST /api/topic-proposals/:proposalId/decision`
Approve or reject a stored proposal.

Example response:
```json
{
  "proposal_id": "prop_001",
  "status": "approved"
}
```

## 5. Recommended Minimal V1 Surface

If we want to keep V1 tight, the minimum useful endpoint set is:

- `GET /api/topics?q=...&limit=...`
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`
- `POST /api/learner/snapshot`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `POST /api/questions`
- `POST /api/quizzes`
- `GET /api/quizzes/:quizId/items`
- `POST /api/quiz-items/:quizItemId/response-draft`
- `POST /api/quizzes/:quizId/responses/submit`
- `POST /api/quizzes/:quizId/review-draft`
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `POST /api/quizzes/:quizId/review-draft/finalize`
- `GET /api/quizzes/:quizId/results`
- `POST /api/quizzes/:quizId/feedback`
- `GET /api/learner-model/updates?status=...&limit=...`
- `GET /api/progress/overview`
- `GET /api/activity?topic_id=...&limit=...`
- `GET /api/review-items?topic_id=...&limit=...`
- `POST /api/topics`
- `PATCH /api/topics/:topicId`
- `POST /api/topics/:topicId/tags`
- `DELETE /api/topics/:topicId/tags/:tag`
- `POST /api/topic-edges`
- `DELETE /api/topic-edges/:edgeId`

## 6. Open Questions

- Should topic metadata updates use `PATCH /api/topics/:topicId` directly, or should all ontology writes be modeled as append-only change objects?
- Should stored ontology proposals exist in V1, or should AI ask for approval live and then write topics and edges directly?
- Do we want separate endpoints for topic aliases, or treat them as part of topic metadata updates?
