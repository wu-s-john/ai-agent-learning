# AI Learning System Design

## 1. Goals and Motivations

### Problem
Most learning tools are either:
- static flashcard systems with weak adaptivity
- chat tools with no durable memory of what the learner actually knows
- note systems that store content well but do not challenge the learner intelligently

We want a system that can:
- model a learner's current knowledge
- ask better questions over time
- detect weak and underexplored areas
- make learning feel like a sequence of sharp challenges rather than passive content review
- use quiz responses to grow the learner's knowledge model, not just produce a score

### Product Goal
Build a general-purpose learning system whose primary interface is a chat-based AI agent that challenges the learner, grades responses, and uncovers gaps over time.

### Core Goals
- Make chat the primary learning interface.
- Use learner responses as the main signal of knowledge.
- Keep a durable, inspectable model of current knowledge.
- Reuse and improve a persistent question pool.
- Support multiple quiz purposes, including mastery checks, interview simulation, diagnosis, and evidence gathering for the learner model.
- Make the system adaptive across many subjects, not just one domain.
- Keep the server simple and reliable while letting the AI handle interpretation and decisions.

### Non-Goals
- Not a full LMS.
- Not primarily a document-ingestion product.
- Not a pure Anki clone.
- Not a free-form AI memory blob with no structure.

## 2. Interface

### Primary Interface: Chat Agent
The main product surface is a single AI agent that interacts with the learner through chat.

The agent can:
- start a quiz for a topic or tag scope
- ask questions one at a time
- grade answers
- explain weaknesses and strengths
- inspect what it thinks the learner knows
- infer likely gaps and suggest what to work on next

The agent is one runtime actor. "Coach", "grader", and "question curator" are internal skill modes, not separate AI services.

### Product Priority
The highest-value feature after quizzes is model inspection: showing what the learning system thinks the learner knows, does not know, has explored, and should be challenged on next.

This matters more than reference lookup because the product is centered on an evolving learner model, not on retrieving notes. Reference lookup is useful, but it should support explanations and grounding rather than define the core experience.

### Secondary Interface: Next.js Web UI
The Next.js app supports workflows that benefit from inspection and review:
- seeing quiz results
- submitting quiz feedback
- inspecting topic profiles
- viewing overall learning progress
- reviewing inferred ontology and tag recommendations before applying them

Recommended UI routes and backing API endpoints:

| UI route | Purpose | Backing API |
| --- | --- | --- |
| `/quizzes/:quizId/results` | Review draft results or finalized quiz results | `GET /api/quizzes/:quizId/review-draft`, `GET /api/quizzes/:quizId/results` |
| `/quizzes/:quizId/results` | Edit and finalize staged review | `PATCH /api/quizzes/:quizId/review-draft`, `POST /api/quizzes/:quizId/review-draft/finalize` |
| `/quizzes/:quizId/results` | Submit quiz feedback | `POST /api/quizzes/:quizId/feedback` |
| `/topics/:topicId` | Inspect a topic profile | `GET /api/topics/:topicId/profile`, `GET /api/topics/:topicId/edges` |
| `/progress` | Inspect overall learning progress | `GET /api/progress/overview` |
| `/ontology/proposals` | Review inferred ontology and tag proposals | `GET /api/topic-proposals?status=pending`, `POST /api/topic-proposals/:proposalId/decision` |

### Graph Visualization in Next.js
The Next.js UI should also expose a simple graph view of the learner model.

The graph should use one base topic graph with a learner overlay rather than two separate graph systems.

- base graph = ontology structure between topics
- learner overlay = current learner state drawn on top of the same nodes

Each node is a topic.

Each edge is one of:
- `prereq_of`
- `part_of`
- `related_to`

The visual encoding should stay intentionally simple:
- node fill color = `knowledge_score`
- node border thickness or opacity = `coverage_score`
- small badge or dot = due / review-needed state
- optional warning indicator = active misconception

The exact learner details should live in a side panel, not in the graph itself. The panel can show:
- overview
- strengths
- weaknesses
- recent quizzes
- next recommended topics

The primary graph experience should be a focus view:
- selected topic in the center
- immediate prerequisites, parts, and related topics around it

A broader map view can exist later for exploration, but the focus view should be the default because it is easier to read and more useful for studying.

Edge styling should also remain simple:
- `prereq_of` = directed arrow
- `part_of` = solid line
- `related_to` = dashed line

### CLI
The CLI can mirror the same server calls as the chat agent and UI. It is mainly useful for debugging, scripting, and local development.

## 3. Architecture

### High-Level Architecture
The system has three major layers:

1. AI agent
- understands user intent
- chooses a workflow skill
- calls server endpoints
- interprets returned data
- produces structured outputs like quiz plans and grades

2. Server
- stores canonical data
- exposes simple query and write endpoints
- performs deterministic retrieval, filtering, ranking, projections, and similarity search
- does not do AI reasoning

3. Database and async processing
- Postgres is the source of truth
- learner activity is written to an immutable ledger
- projections derive current topic profiles, review state, and dashboard summaries

### Simplicity and Flexibility Principle
Prefer a small set of generic primitives over many specialized workflow objects.

The core primitives should be enough to support most product behavior:
- topics and topic edges
- questions and question-topic links
- quizzes and ordered quiz items
- responses and grades
- quiz feedback events
- topic profile and progress projections

The AI should create flexibility through prompting, quiz planning, grading posture, and interpretation. The backend should stay boring: store data, retrieve data, and update deterministic projections.

When a feature creates a choice between mutation-heavy correctness and append-only simplicity, prefer append-only simplicity for V1 unless the user experience clearly requires retroactive edits.

### Why the Server-AI Interaction Matters
The most important architectural boundary is between the AI agent and the server.

The server should be retrieval-smart but not reasoning-smart.

The server may:
- run exact search
- run full-text search
- run vector similarity search
- merge lexical and semantic results
- filter, rank, and paginate data
- compute deterministic projections

The server should not:
- grade answers
- diagnose knowledge gaps
- decide what to study next
- infer new topics or edges
- plan quizzes
- summarize results in natural language

This boundary matters because it keeps:
- reasoning centralized in one AI agent
- server behavior inspectable and predictable
- data access fast and composable
- workflows easier to debug

### Semantic Search and Vector Similarity
Semantic search is allowed on the server because it is retrieval infrastructure, not reasoning.

The simplest useful rule is:
- use exact and alias search when the query names a known object directly
- use fuzzy lexical search when the query is misspelled, partial, or near a title
- use full-text search when the query shares important keywords
- use vector similarity when the query is conceptual
- merge all candidates into one ranked result set

This is especially useful for:
- topic search
- question retrieval
- secondary reference lookup

Examples:
- "quiz me on zk folding stuff"
- "help me with compiler optimization"
- "find my notes about polynomial commitments"

The server can map those fuzzy queries to stored objects by embedding both the query and the stored content, then ranking by vector similarity.

Recommended hybrid retrieval flow:
1. Run exact and alias search.
2. Run fuzzy lexical search.
3. Run full-text search.
4. Run vector similarity search.
5. Merge candidates.
6. Apply deterministic reranking using:
   - exact or alias match strength
   - fuzzy string similarity
   - full-text rank
   - vector similarity score
   - tag overlap
   - graph neighborhood if relevant
   - quality and status filters
7. Return the ranked result set to the AI.

The server should return retrieval signals such as:
- `match_type`
- `score`
- `source`

The AI then decides how to use the returned candidates.

Good embedding targets include:
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
  - document chunk text

Embedding creation should be boring and deterministic:
1. A searchable object is created or updated.
2. The server builds a canonical text string for that object.
3. The server hashes the canonical text plus embedding model.
4. The server tries to create the embedding synchronously through an embedding adapter.
5. If embedding succeeds, the vector row is stored.
6. If embedding fails, the object is still saved and the embedding is marked pending for retry or backfill.

Do not embed every row in V1. Embeddings should be limited to retrieval targets:
- `topics`
- `questions`
- `reference_chunks`

Do not embed these in V1:
- raw learner responses
- review drafts
- grade results
- topic profiles
- activity events

This should be implemented as a retrieval layer on top of Postgres, for example with vector storage and similarity indexing, not as a separate reasoning system.

Implementation defaults:
- use Dockerized Postgres with pgvector for local development
- use UUID primary keys plus readable slugs for important objects
- seed one local learner for V1 while keeping `user_id` in learner-owned tables
- use audit events plus normal relational state tables, not full event sourcing
- attempt embeddings synchronously with a pending fallback
- finalize quiz reviews in a single database transaction

### Core Data Model

Canonical relationships:
- `Topic` has many tags and graph edges
- `Question` links to many `Topic` records through `question_topics`
- `Question` has many flexible `question_tags`
- `Quiz` has many ordered `QuizItem` records
- `QuizItem` references one `Question` and stores prompt, answer-key, topic, and tag snapshots
- `Response` belongs to one `QuizItem` and stores the learner's answer plus item outcome
- `ReviewDraftItem` belongs to one `Response` and stores staged AI feedback/evidence
- `GradeResult` belongs to one finalized `ReviewDraftItem`
- `GradeTopicEvidence` links one finalized grade to one or more topics
- topic profiles and progress dashboards are projections over finalized grades, topic evidence, activity, and review state

#### Topics
Topics are flat first-class units of knowledge.

Each topic has:
- `topic_id`
- `title`
- `tags`

Topics are organized by:
- tags for broad grouping
- graph edges for structure

Ontology curation should support:
- adding new topics
- modifying existing topic metadata
- adding or removing tags
- adding or removing graph edges

Supported edge types:
- `prereq_of`
- `part_of`
- `related_to`

#### Topic Profiles
The AI-facing learner model is a topic profile projection.

Each topic profile includes:
- `overview`
- `knowledge_score`
- `coverage_score`
- `strengths`
- `weaknesses`
- `active_misconceptions`
- `recent_quizzes`
- `last_reviewed_at`
- `evidence_count`
- `next_recommended_topics`

`knowledge_score` answers:
- how well the learner seems to know the topic

`coverage_score` answers:
- how much of the topic has actually been explored and tested

#### Quizzes
A quiz is the main challenge unit.

The system can support a wide variety of quiz experiences because the AI controls the prompting, difficulty, tone, and grading posture. The backend stays abstract enough to support all of them with the same core objects: quizzes, ordered quiz items, responses, and grades.

Examples:
- topic-scoped quiz
- explain-back quiz
- diagnostic quiz
- interview-simulation quiz
- model-building quiz

A quiz contains ordered quiz items, which are concrete instances of questions.

Every quiz item should reference a real question-pool row. If the AI wants to ask a custom question, it should first search for similar existing questions, create a new question if needed, and then include that question by reference in the quiz.

Quizzes can serve different purposes without changing the core API:
- mastery check: push toward durable understanding of a topic
- interview simulation: use harder prompts, stricter grading, and less hinting
- diagnosis: probe weak or underexplored areas
- model building: gather evidence so the system can update topic profiles, coverage, misconceptions, and ontology recommendations

The AI can carry this purpose inside its `QuizPlan` reasoning. The server does not need to understand the purpose beyond storing the quiz, quiz items, responses, and grades.

A quiz may optionally store assessment context. These fields are metadata for later interpretation; the server does not reason about them:
- `purpose`
- `grading_posture`
- `difficulty_target`
- `hint_policy`
- `time_pressure`
- `answer_reveal_policy`

`answer_reveal_policy` controls when the AI should reveal correctness, answer keys, or feedback in chat:
- `after_each_item`: the AI may reveal feedback after each item
- `after_quiz`: the AI should wait until the quiz is submitted or reviewed
- `never_in_chat`: the AI should keep answers and feedback out of chat and rely on the review/results UI

Quiz status should stay simple in V1:
- `created`: quiz items exist, but no responses have been saved
- `in_progress`: at least one response draft has been durably saved
- `responses_submitted`: raw responses are locked and ready for AI review-draft generation
- `review_drafted`: AI feedback/evidence is staged for learner review
- `finalized`: immutable grades and learner-model updates have been applied, so results are ready

#### Questions
Questions live in a reusable question pool.

Questions can have:
- one or more linked topics
- a modality such as MCQ, free response, or explain-back
- flexible question tags such as `definition`, `proof`, `interview`, `diagnostic`, or `open-cover`
- optional answer-key metadata for MCQ or exact-answer questions
- quality and difficulty metadata
- a status such as `active` or `retired`

V1 does not store rubrics. The AI grades using the question prompt, modality, linked topics, question tags, optional answer key, learner response, and its own domain knowledge.

Question status semantics:
- `active`: usable question, preferred for reuse
- `retired`: unavailable for new quizzes because it was low quality, obsolete, or misleading

AI-created questions do not need a separate generated/reviewed lifecycle. If the AI creates a useful custom question, it can be stored as a normal `active` question. Quality is handled later through quiz feedback, response feedback, edits, or retirement.

Questions should relate to topics through a many-to-many relationship, for example `question_topics`.

This matters because one question may:
- primarily target one topic
- still depend on or probe nearby topics
- produce evidence for multiple topics once graded

Questions should also have many-to-many tags through `question_tags`. Tags are not ontology structure; they are flexible retrieval and quiz-planning labels.

#### Responses, Review Drafts, and Grades
The core answer chain is:

`Question -> QuizItem -> Response -> ReviewDraftItem -> GradeResult`

Important modeling rules:
- responses belong to quiz items, not directly to questions
- during a live chat quiz, answers should be saved as durable response drafts so reloads or AI restarts do not lose assessment evidence
- response drafts can be edited until the quiz responses are submitted
- submitted responses are locked and should not be changed
- AI feedback first becomes a mutable review draft, not an immutable grade
- the learner can inspect and edit review-draft feedback in Next.js before finalization
- finalization creates immutable grades and applies learner-model updates
- grades are never updated after finalization
- quiz feedback is stored separately from responses and grades

Quiz item outcomes:
- `answered`: learner submitted an answer
- `skipped`: learner intentionally skipped the item
- `no_answer`: item was presented but no answer was provided before submission
- `timed_out`: time limit expired before an answer was provided
- `abandoned`: quiz ended while this presented item was still unresolved
- `excluded`: item should not affect learner-model updates

When the AI shows a quiz item, it should immediately save a durable draft outcome of `no_answer`. If the learner later answers, skips, times out, or abandons the item, that draft is updated. Quiz items that were never shown to the learner should remain outcome-less and should not count as evidence.

Response states:
- `draft`: raw answer is durably saved but still editable
- `submitted`: raw answer is locked and ready for review-draft generation
- `review_drafted`: AI feedback/evidence exists in a mutable review draft
- `finalized`: immutable grade/evidence has been created
- `excluded`: reviewed response was intentionally excluded from learner-model updates

Canonical review evidence schema:
- `review_rating`: `Again`, `Hard`, `Good`, or `Easy`
- `evidence_score`: overall confidence in the response evaluation, from `0` to `1`
- `topic_evidence`: per-topic evidence emitted by the review draft
- `topic_evidence.topic_id`: existing topic ID
- `topic_evidence.evidence_strength`: strength of evidence for current knowledge, from `0` to `1`
- `topic_evidence.coverage_signal`: how much this item explored the topic, from `0` to `1`
- `excluded`: whether the item should be ignored by learner-model projections

#### Review State
Cooldown and due logic should be per-user derived state, not a property of the question itself.

Examples:
- per-user question review state
- per-user topic review state

### Event Ledger and Projections
Learner activity should be appended to an immutable ledger.

Examples of events:
- quiz created
- response draft saved
- quiz item outcome saved
- responses submitted
- review draft created
- review draft edited
- review finalized
- quiz feedback submitted

Projections then derive:
- topic profiles
- learning progress summaries
- per-user review state
- recent misconceptions

### Learner Model Update Rule
Keep V1 simple by making learner-model updates append-only.

Recommended lifecycle:
1. The learner answers quiz items in chat.
2. The AI saves each presented item outcome as a durable response draft, including answered, skipped, no-answer, timed-out, or abandoned outcomes.
3. When the learner finishes, the AI submits the response drafts and outcomes with an idempotency key.
4. The server locks submitted responses and item outcomes, then marks the quiz `responses_submitted`.
5. The AI creates a mutable review draft with proposed feedback, ratings, misconceptions, and topic evidence.
6. The learner reviews that draft in Next.js. The learner may edit feedback text, add dispute notes, or exclude invalid items, but cannot directly change ratings or evidence.
7. The learner finalizes the review draft.
8. The server creates immutable grades, computes deterministic learner-model updates, and marks the quiz `finalized`.
9. If the learner later disagrees with the quiz, they submit quiz feedback as a new event.

Once a review draft is finalized, do not mutate responses, grades, or learner-model evidence in place. For V1, later corrections should be additive quiz feedback only. If the learner wants another attempt, create a new quiz response in a future quiz rather than editing the processed past.

There should not be a separate queue abstraction in V1. Pending/applied learner-model updates can be exposed through a read-only status endpoint for debugging, but normal processing happens when the review draft is finalized.

Review drafts are staging records, so the server should validate them before they become canonical evidence:
- a draft item must reference a submitted response from the same quiz
- a response may appear at most once in a review draft
- the draft item outcome must match the stored quiz item outcome
- non-excluded draft items require `review_rating` and at least one `topic_evidence` row
- excluded draft items may omit rating and evidence and do not affect learner-model updates
- finalization rejects empty review drafts and any non-excluded item that still needs AI re-review

#### V1 Projection Rule
The AI can propose ratings, feedback, misconceptions, `evidence_score`, and topic evidence in the review draft, but it should not submit canonical `knowledge_delta` or `coverage_delta` values.

When a review draft is finalized, the server applies deterministic projection rules:
- `coverage_score` increases from finalized topic evidence using `coverage_signal`, topic weight, and a small per-item cap
- `knowledge_score` updates from a bounded observation derived from `review_rating` and `evidence_strength`
- `Again`, `Hard`, `Good`, and `Easy` map to stable numeric observations, for example `0.15`, `0.45`, `0.75`, and `0.9`
- repeated evidence should move scores gradually, not jump dramatically from one answer
- excluded review draft items do not affect topic scores or review scheduling
- misconceptions are added from finalized review items and can decay or be resolved through later finalized evidence

This keeps mastery scores from drifting with grader style. The AI provides interpreted evidence, while the server owns the score math.

Learner review edits are intentionally limited. If the learner disagrees with a rating, evidence score, or topic evidence, the review item should be marked `needs_ai_re_review` with a dispute reason. The AI can then produce a revised review draft before finalization. This avoids turning the learner model into self-reported mastery.

## 4. Workflows

### 4.1 Start Quiz
The app is challenge-first. Starting a quiz means starting a challenge, not a lesson. Topic context is used to choose better questions, but the core interaction is assessment through prompts and responses.

The quiz may be for mastery, interview simulation, gap diagnosis, or gathering evidence to improve the learner model. This affects how the AI chooses and presents questions, but it does not require a different server API.

1. `[Learner -> AI]` Ask to be quizzed on a topic or tag scope, such as topology or compilers.
2. `[AI -> Server]` Search candidate topics. `GET /api/topics?q=...&limit=...`
   Query:
   ```json
   { "q": "topology", "limit": 10 }
   ```
3. `[Server -> AI]` Return topic matches with `topic_id`, `title`, `tags`, `match_type`, and `score`.
   ```json
   {
     "matches": [
       {
         "topic_id": "topology",
         "title": "Topology",
         "tags": ["math", "topology"],
         "match_type": "exact",
         "score": 0.97
       }
     ],
     "resolved": true
   }
   ```
   If the topic does not resolve, the AI should ask the learner to choose or create a topic before creating questions or a quiz.
4. `[AI -> Server]` Fetch learner state for the topic neighborhood. `POST /api/learner/snapshot`
   Body:
   ```json
   {
     "topic_ids": ["topology", "open_sets", "compactness"],
     "include_related": true,
     "include_prereqs": true,
     "limit_per_bucket": 10
   }
   ```
5. `[Server -> AI]` Return raw topic profiles and nearby topic state. The AI infers weak topics and recommended targets from this data; the server does not diagnose them.
   ```json
   {
     "topics": [
       {
         "topic_id": "compactness",
         "knowledge_score": 0.22,
         "coverage_score": 0.78,
         "weaknesses": ["open-cover definition"]
       }
     ],
     "related_topics": [
       {
         "topic_id": "open_covers",
         "edge_type": "prereq_of",
         "knowledge_score": 0.41,
         "coverage_score": 0.52
       }
     ],
     "recent_activity": [
       {
         "topic_id": "compactness",
         "review_rating": "Hard"
       }
     ]
   }
   ```
6. `[AI -> Server]` Search semantically similar existing questions. `GET /api/questions?q=...&topic_id=...&limit=...`
   Query:
   ```json
   {
     "q": "open-cover compactness definition",
     "topic_id": "compactness",
     "tag": "definition",
     "difficulty_target": 0.6,
     "include_due": true,
     "limit": 30
   }
   ```
7. `[Server -> AI]` Return ranked existing questions with modality, difficulty, due-ness, quality, and query-time retrieval signals. These signals explain retrieval only; they are not learner-model evidence.
   ```json
   {
     "questions": [
       {
         "question_id": "q_compact_2",
         "topic_ids": ["compactness", "open_covers"],
         "question_tags": ["definition", "open-cover"],
         "modality": "free_response",
         "difficulty": 0.58,
         "due": true,
         "due_at": "2026-04-28T18:00:00Z",
         "quality_score": 0.91,
         "match_type": "vector",
         "score": 0.87,
         "retrieval_score": 0.87,
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
8. `[AI -> AI]` Decide whether existing questions are sufficient. If not, generate disjoint custom questions based on the learner snapshot and similar-question results.
9. `[AI -> Server]` Create any needed custom questions in the pool first. `POST /api/questions`
   Body:
   ```json
   {
     "topic_ids": ["compactness", "open_covers"],
     "modality": "free_response",
     "status": "active",
     "prompt": "Explain why the open-cover definition of compactness is not the same as closed and bounded in every topological space.",
     "question_tags": ["definition", "conceptual", "diagnostic"],
     "answer_key": null
   }
   ```
10. `[Server -> AI]` Return created question metadata.
    ```json
    {
      "question_id": "q_gen_001",
      "status": "active",
      "created": true
    }
    ```
11. `[AI -> AI]` Build a challenge-oriented `QuizPlan` using only question-pool IDs.
12. `[AI -> Server]` Create a quiz from the plan. `POST /api/quizzes`
   Body:
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
13. `[Server -> AI]` Return created quiz metadata and the ordered quiz items the AI should present.
    ```json
    {
      "quiz_id": "quiz_001",
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
14. `[AI -> Learner]` Present the first question from the ordered quiz item list.

### 4.2 Answer Quiz Item
During a live quiz, learner answers should be saved as durable drafts. The AI can still keep conversational context, but the server should have the raw answer so reloads, browser failures, or AI restarts do not lose assessment evidence.

The learner can also ask the AI not to reveal answers or feedback in chat until the end of the quiz. This is controlled by `answer_reveal_policy`. The response-draft endpoint can update or echo the effective policy, but it still does not grade or reveal correctness.

If the learner abandons the quiz, draft responses may remain saved, but they are not submitted, graded, or used for the learner model.

1. `[AI -> Learner]` Present the current quiz item.
2. `[AI -> Server]` Immediately mark the item as shown but unanswered. `POST /api/quiz-items/:quizItemId/response-draft`
   Body:
   ```json
   {
     "outcome": "no_answer",
     "answer_text": null,
     "image_refs": [],
     "submitted_from": "chat",
     "answer_reveal_policy": "after_quiz"
   }
   ```
3. `[Server -> AI]` Return the durable draft response metadata.
   ```json
   {
     "response_id": "resp_002",
     "quiz_id": "quiz_001",
     "quiz_item_id": "qi_002",
     "outcome": "no_answer",
     "response_state": "draft",
     "answer_reveal_policy": "after_quiz",
     "quiz_status": "in_progress"
   }
   ```
4. `[Learner -> AI]` Answer, skip, time out, or abandon the current quiz item.
5. `[AI -> Server]` Update the response draft and item outcome. `POST /api/quiz-items/:quizItemId/response-draft`
   Body:
   ```json
   {
     "outcome": "answered",
     "answer_text": "A space is compact if every open cover has a finite subcover.",
     "image_refs": [],
     "submitted_from": "chat",
     "answer_reveal_policy": "after_quiz"
   }
   ```
6. `[Server -> AI]` Return the updated draft response metadata.
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
7. `[AI -> Learner]` Present the next quiz item from the AI's local quiz item list. If `answer_reveal_policy` is `after_quiz` or `never_in_chat`, do not reveal correctness, answer keys, or grading feedback in chat.
8. `[Learner -> AI]` Optionally revise an answer before responses are submitted.
9. `[AI -> Server]` Save the revision through the same response-draft endpoint. `POST /api/quiz-items/:quizItemId/response-draft`
   Skip or no-answer outcomes use the same endpoint:
   ```json
   {
     "outcome": "skipped",
     "answer_text": null,
     "image_refs": [],
     "submitted_from": "chat"
   }
   ```

### 4.3 Submit Quiz Responses
Responses are submitted when the quiz ends naturally or when the learner asks to end early. The server submits all saved outcomes for presented quiz items, including answered, skipped, no-answer, timed-out, and abandoned items. This locks the raw responses and outcomes, then produces the payload the AI needs to create a review draft. The learner model is not updated yet.

1. `[Learner -> AI]` Finish the quiz or ask to end early.
2. `[AI -> Server]` Submit all saved response drafts and item outcomes for the quiz with an idempotency key. `POST /api/quizzes/:quizId/responses/submit`
   Body:
   ```json
   {
     "idempotency_key": "quiz_001_submit_responses_001",
     "submitted_from": "chat"
   }
   ```
3. `[Server -> AI]` Atomically lock submitted responses, mark the quiz `responses_submitted`, and return response IDs plus a minimal review payload.
   ```json
   {
     "quiz_id": "quiz_001",
     "status": "responses_submitted",
     "responses": [
       {
         "quiz_item_id": "qi_002",
         "response_id": "resp_002",
         "outcome": "answered",
         "response_state": "submitted"
       }
     ],
     "review_payload": [
       {
         "response_id": "resp_002",
         "quiz_item_id": "qi_002",
         "question": {
           "question_id": "q_compact_2",
           "topic_ids": ["compactness", "open_covers"],
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
4. `[AI -> AI]` Produce review-draft feedback, proposed ratings, misconceptions, and topic evidence. This is not an immutable grade yet.
5. `[AI -> Server]` Store the mutable review draft. `POST /api/quizzes/:quizId/review-draft`
   Body:
   ```json
   {
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
           }
         ],
         "excluded": false
       }
     ]
   }
   ```
6. `[Server -> AI]` Return review-draft metadata and mark the quiz `review_drafted`.
   ```json
   {
     "quiz_id": "quiz_001",
     "review_draft_id": "qrd_001",
     "status": "review_drafted"
   }
   ```

### 4.4 See Quiz Results / Review Draft
The quiz results page is the main post-quiz inspection surface. It has two states:
- draft review state: the quiz has staged AI feedback, but grades are not immutable yet
- finalized results state: the quiz has immutable grades and learner-model updates

In the draft review state, the learner can inspect questions, responses, item outcomes, AI feedback, proposed ratings, and topic evidence before finalization. The learner can edit display feedback, add dispute notes, or exclude invalid items. The learner should not directly edit ratings, evidence scores, or topic evidence. If those need to change, the item should be marked for AI re-review before finalization.

1. `[Next.js UI -> Server]` Open the quiz results page in draft state. `GET /api/quizzes/:quizId/review-draft`
2. `[Server -> Next.js UI]` Return questions, responses, item outcomes, AI feedback, proposed ratings, topic evidence, and stored summary fields.
   ```json
   {
     "quiz_id": "quiz_001",
     "review_draft_id": "qrd_001",
     "status": "review_drafted",
     "summary": {
       "overview": "Strong compactness definition, but basis definitions need more precision.",
       "strengths": ["Correct formal definition"],
       "weaknesses": ["Needs more precision around basis definitions"],
       "improvement_targets": ["basis_for_topology", "open_covers"]
     },
     "items": [
       {
         "quiz_item_id": "qi_002",
         "response_id": "resp_002",
         "outcome": "answered",
         "prompt": "State the definition of compactness using open covers.",
         "answer_text": "A space is compact if every open cover has a finite subcover.",
         "overall_feedback": "Good definition. You captured both open covers and finite subcovers.",
         "review_rating": "Good",
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
3. `[Learner -> Next.js UI]` Edit feedback text, add a dispute note, or mark an invalid item as excluded from model updates.
4. `[Next.js UI -> Server]` Save review-draft edits. `PATCH /api/quizzes/:quizId/review-draft`
   Body:
   ```json
   {
     "items": [
       {
         "review_draft_item_id": "rdi_002",
         "overall_feedback": "Correct definition; keep practicing examples and non-examples.",
         "learner_note": "This feedback is fair, but I want a harder follow-up.",
         "dispute_reason": null,
         "excluded": false
       }
     ]
   }
   ```
5. `[Server -> Next.js UI]` Save the safe learner edits. If a dispute reason is provided, mark the item `needs_ai_re_review`.
6. `[AI -> Server]` If the learner asks in chat for finalized results, fetch the finalized result payload. `GET /api/quizzes/:quizId/results`
7. `[Server -> AI]` If the quiz has not reached `finalized`, return a not-ready status. Otherwise return full quiz results with overview, strengths, weaknesses, improvement targets, rating counts, per-item feedback, and topic deltas.
   ```json
   {
     "quiz_id": "quiz_001",
     "status": "finalized",
     "results_ready": true,
     "overview": "You did well on open sets and compactness, but bases are still incomplete.",
     "strengths": ["Strong compactness definition"],
     "weaknesses": ["Basis definitions need more precision"],
     "improvement_targets": ["basis_for_topology", "open_covers"],
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
8. `[AI -> Learner]` Summarize finalized results in chat, or explain that the quiz is still in draft review state.

### 4.5 Finalize Quiz Review
Finalization is an action from the results page. It turns staged review evidence into immutable grades and learner-model updates. Once finalized, grades can never be updated.

Finalization should reject a review draft if any non-excluded item still has `needs_ai_re_review: true`.

1. `[Learner -> Next.js UI]` Submit the final review from the results page.
2. `[Next.js UI -> Server]` Finalize the review draft. `POST /api/quizzes/:quizId/review-draft/finalize`
   Body:
   ```json
   {
     "idempotency_key": "quiz_001_finalize_review_001"
   }
   ```
3. `[Server -> Next.js UI]` Create immutable grades, compute deterministic learner-model updates from finalized evidence, and mark the quiz `finalized`.
   ```json
   {
     "quiz_id": "quiz_001",
     "status": "finalized",
     "grades": [
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
         "applied": true
       }
     ],
     "results_ready": true
   }
   ```
4. `[Next.js UI -> Server]` Fetch finalized results for rendering. `GET /api/quizzes/:quizId/results`
5. `[Server -> Next.js UI]` Return finalized result payload.

### 4.6 Explain Back
1. `[Learner -> AI]` Ask to explain a topic in their own words.
2. `[AI -> Server]` Search topics and fetch the learner snapshot. `GET /api/topics?q=...&limit=...`, `POST /api/learner/snapshot`
   Query and body:
   ```json
   { "q": "raft", "limit": 10 }
   ```
   ```json
   {
     "topic_ids": ["raft", "leader_election", "log_replication"],
     "include_related": true,
     "include_prereqs": true
   }
   ```
3. `[Server -> AI]` Return topic matches and learner state for the requested topic neighborhood.
   ```json
   {
     "matches": [
       { "topic_id": "raft", "title": "Raft", "match_type": "exact", "score": 0.98 }
     ],
     "topics": [
       { "topic_id": "raft", "knowledge_score": 0.58, "coverage_score": 0.63 }
     ]
   }
   ```
4. `[AI -> Server]` Search similar explain-back prompts, create any needed prompt in the question pool, and then create an explain-back quiz from question refs. `GET /api/questions?q=...&topic_id=...&limit=...`, optional `POST /api/questions`, `POST /api/quizzes`
   Query:
   ```json
   {
     "q": "explain raft in your own words",
     "topic_id": "raft",
     "limit": 5
   }
   ```
5. `[Server -> AI]` Return similar questions and created quiz metadata whose quiz items use the `explain_back` modality.
   ```json
   {
     "questions": [
       {
         "question_id": "q_raft_explain_1",
         "topic_ids": ["raft", "leader_election"],
         "modality": "explain_back"
       }
     ]
   }
   ```
6. `[Learner -> AI]` Explain the topic.
7. `[AI -> Server]` Save the explanation as a durable response draft. `POST /api/quiz-items/:quizItemId/response-draft`
8. `[AI -> Server]` When the learner finishes, submit the response draft through the same submit path. `POST /api/quizzes/:quizId/responses/submit`
9. `[Server -> AI]` Return the response ID and review payload for the explain-back item.
10. `[AI -> AI]` Create review-draft feedback for correctness, depth, coverage, articulation, and misconceptions.
11. `[AI -> Server]` Store the mutable review draft. `POST /api/quizzes/:quizId/review-draft`
12. `[Next.js UI -> Server]` Open the quiz results page in draft state so the learner can inspect, edit, and finalize the review. `GET /api/quizzes/:quizId/review-draft`, `PATCH /api/quizzes/:quizId/review-draft`, `POST /api/quizzes/:quizId/review-draft/finalize`
13. `[AI -> Learner]` Return explain-back feedback and any follow-up prompt after finalization.

### 4.7 Find Gaps
1. `[Learner -> AI]` Ask what gaps they have in a subject or topic area.
2. `[AI -> Server]` Search for the broad topic or subject. `GET /api/topics?q=...&limit=...`
   Query:
   ```json
   { "q": "distributed systems", "limit": 10 }
   ```
3. `[Server -> AI]` Return topic matches for the requested area.
   ```json
   {
     "matches": [
       {
         "topic_id": "distributed_systems",
         "title": "Distributed Systems",
         "match_type": "tag",
         "score": 0.93
       }
     ],
     "resolved": true
   }
   ```
4. `[AI -> Server]` Fetch graph neighbors, topic profiles, learner activity, review state, and optionally question history. `GET /api/topics/:topicId/edges`, `GET /api/topics/:topicId/profile`, `GET /api/activity?topic_id=...&limit=...`, `GET /api/review-items?topic_id=...&limit=...`, optional `GET /api/questions?q=...&topic_id=...&limit=...`
5. `[Server -> AI]` Return neighboring topics and edge types, topic profiles, recent question/tag history, review ratings, and due or nearly due review items.
   ```json
   {
     "edges": [
       { "topic_id": "raft", "edge_type": "part_of" },
       { "topic_id": "linearizability", "edge_type": "part_of" },
       { "topic_id": "quorums", "edge_type": "related_to" }
     ],
     "profiles": [
       { "topic_id": "raft", "knowledge_score": 0.54, "coverage_score": 0.77 },
       { "topic_id": "linearizability", "knowledge_score": 0.21, "coverage_score": 0.29 }
     ],
     "activity": [
       {
         "question_id": "q_raft_safety_1",
         "question_tags": ["safety", "free-response"],
         "review_rating": "Again"
       }
     ],
     "review_items": [
       {
         "question_id": "q_raft_log_1",
         "topic_ids": ["raft", "log_replication"],
         "question_tags": ["log-replication"],
         "due_at": "2026-04-26T18:00:00Z"
       }
     ]
   }
   ```
6. `[AI -> AI]` Infer weak topics, underexplored topics, likely blockers, and next study targets. The server does not return a gap diagnosis directly.
7. `[AI -> Learner]` Explain the gap analysis or offer to start a diagnostic quiz.

### 4.8 Inspect Topic
This is a primary workflow. It is the main way the learner can inspect and sanity-check the system's model of their knowledge.

1. `[Learner -> AI]` Ask what the system thinks they know about a topic.
2. `[AI -> Server]` Resolve the topic name. `GET /api/topics?q=...&limit=...`
   Query:
   ```json
   { "q": "compactness", "limit": 10 }
   ```
3. `[Server -> AI]` Return topic matches with confidence signals.
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
4. `[AI -> Server]` Fetch the learner-facing topic profile and optional graph neighborhood. `GET /api/topics/:topicId/profile`, optional `GET /api/topics/:topicId/edges`
5. `[Server -> AI]` Return the topic profile with scores, overview, strengths, weaknesses, misconceptions, next recommended topics, and optional prerequisites/parts/related topics.
   ```json
   {
     "topic_id": "compactness",
     "overview": "Partial intuition, weak formal articulation.",
     "knowledge_score": 0.32,
     "coverage_score": 0.61,
     "strengths": ["Recognizes compactness as a global property"],
     "weaknesses": ["Cannot define compactness cleanly via open covers"],
     "next_recommended_topics": ["open_covers", "finite_subcovers"]
   }
   ```
6. `[AI -> Learner]` Explain the learner's current state on that topic.

### 4.9 Inspect Learning Progress
This is a primary dashboard workflow. It answers what the system currently believes about the learner across all tracked topics.

1. `[Learner -> AI]` Ask for an overall progress view.
2. `[AI -> Server]` Fetch the deterministic progress overview. `GET /api/progress/overview`
3. `[Server -> AI]` Return `global_overview`, strongest topics, weakest topics, underexplored topics, most reviewed topics, and recent misconceptions.
   ```json
   {
     "global_overview": "Strongest in cryptography. Weaker in topology and compiler backend topics.",
     "strongest_topics": [
       { "topic_id": "hash_functions", "knowledge_score": 0.88, "coverage_score": 0.84 }
     ],
     "weakest_topics": [
       { "topic_id": "compactness", "knowledge_score": 0.22, "coverage_score": 0.78 }
     ],
     "underexplored_topics": [
       { "topic_id": "linearizability", "knowledge_score": 0.21, "coverage_score": 0.29 }
     ]
   }
   ```
4. `[AI -> Learner]` Summarize the most important patterns.
5. `[Next.js UI -> Server]` Fetch the same progress overview for the dashboard. `GET /api/progress/overview`
6. `[Server -> Next.js UI]` Return the same progress payload for rendering.

### 4.10 Submit Quiz Feedback
Quiz feedback does not mutate already-processed responses or grades. It is an additive event used to improve future quizzes, identify confusing questions, and debug grading quality.

1. `[Learner -> Next.js UI]` Submit feedback from the quiz results page.
2. `[Next.js UI -> Server]` Store quiz feedback. `POST /api/quizzes/:quizId/feedback`
   Body:
   ```json
   {
     "feedback_text": "Question 3 felt ambiguous because it did not specify the topology.",
     "quiz_item_id": "qi_003",
     "feedback_type": "question_quality"
   }
   ```
3. `[Server -> Next.js UI]` Return feedback metadata.
   ```json
   {
     "feedback_id": "qfb_001",
     "event_id": "evt_3001",
     "recorded": true
   }
   ```
4. `[Next.js UI -> Learner]` Confirm that the feedback was recorded.
5. `[AI -> Server]` Optionally submit the same feedback if the learner gives it in chat. `POST /api/quizzes/:quizId/feedback`
6. `[Server -> AI]` Return the same feedback metadata.

### 4.11 Reference Lookup
This is a secondary support workflow. It is useful when the AI needs grounding from saved notes or references, but it is less central than showing the learner model through topic profiles, quiz results, and progress views.

1. `[Learner -> AI]` Ask to search saved notes or references.
2. `[AI -> Server]` Query stored references. `GET /api/references?q=...&limit=...`
   Query:
   ```json
   { "q": "polynomial commitments", "limit": 5 }
   ```
3. `[Server -> AI]` Return lexical and vector matched sources with fields like `source_id`, `title`, `snippet`, and `path_or_url`.
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
4. `[AI -> Learner]` Use the returned sources to ground an explanation or clarify a topic.

### 4.12 Infer Ontology Recommendations
The AI should be able to infer ontology changes from evidence.

Examples:
- introduce a missing topic
- split out a repeated weak subtopic
- add a missing `prereq_of` edge
- recommend a new tag
- recommend removing or refining an overly broad tag
- recommend renaming or rewriting a topic description

This is an AI reasoning workflow.

The server should not generate these recommendations itself.

1. `[AI -> Server]` Read topic profiles, graph neighborhoods, activity, question history, and prior quizzes for the scope being analyzed. `GET /api/topics/:topicId/profile`, `GET /api/topics/:topicId/edges`, `GET /api/activity?topic_id=...&limit=...`, `GET /api/questions?q=...&topic_id=...&limit=...`, `GET /api/quizzes?topic_id=...&limit=...`
2. `[Server -> AI]` Return topic profiles, edge neighborhoods, question history, and learner activity for the AI to interpret.
   ```json
   {
     "profile": {
       "topic_id": "raft",
       "knowledge_score": 0.54,
       "coverage_score": 0.77,
       "weaknesses": ["log replication details", "safety reasoning"]
     },
     "activity": [
       {
         "question_id": "q_raft_quorum_1",
         "question_tags": ["quorum-reasoning"],
         "review_rating": "Again"
       }
     ],
     "questions": [
       { "question_id": "q_raft_12", "topic_ids": ["raft", "quorums"] }
     ]
   }
   ```
3. `[AI -> AI]` Infer a proposed topic, tag, or relationship change. The server does not return a recommendation directly.
4. `[AI -> Learner]` Explain the proposal and ask for approval.
5. `[AI -> Server]` Optionally persist the proposal for later UI review. `POST /api/topic-proposals`
   Body:
   ```json
   {
     "proposal_type": "add_topic",
     "topic": {
       "topic_id": "quorums",
       "title": "Quorums",
       "tags": ["distributed-systems", "consensus"]
     },
     "reason": "Repeated blocker in raft-related question families",
     "status": "pending"
   }
   ```
6. `[Server -> AI]` Return stored proposal metadata such as `proposal_id`, `status`, `reason`, and supporting signals.
   ```json
   {
     "proposal_id": "prop_001",
     "saved": true
   }
   ```
7. `[Learner -> AI]` Approve or reject the recommendation.
8. `[AI -> Server]` If approved, store the new topic, tag, or edge through normal write endpoints. `POST /api/topics`, `POST /api/topics/:topicId/tags`, `POST /api/topic-edges`
   Bodies:
   ```json
   {
     "topic_id": "quorums",
     "title": "Quorums",
     "tags": ["distributed-systems", "consensus"]
   }
   ```
   ```json
   {
     "from_topic_id": "quorums",
     "to_topic_id": "raft",
     "edge_type": "prereq_of"
   }
   ```
9. `[Server -> AI]` Return created or updated ontology records.
   ```json
   {
     "topic_id": "quorums",
     "created": true
   }
   ```
10. `[AI -> Learner]` Confirm the ontology change.

### 4.13 Curate Ontology Graph
The learner or operator should be able to directly curate the ontology graph without waiting for AI inference.

Examples:
- add a new topic manually
- modify a topic title or overview
- add or remove tags
- add or remove `prereq_of`, `part_of`, or `related_to` edges

This is a write workflow backed by normal server endpoints. The server remains dumb: it stores changes, validates shape, and exposes the updated graph, but it does not decide what the ontology should be.

1. `[Learner or Operator -> AI]` Request a topic, tag, or graph change.
2. `[AI -> Server]` Create, update, or delete the requested ontology record. `POST /api/topics`, `PATCH /api/topics/:topicId`, `POST /api/topics/:topicId/tags`, `DELETE /api/topics/:topicId/tags/:tag`, `POST /api/topic-edges`, `DELETE /api/topic-edges/:edgeId`
   Example bodies:
   ```json
   {
     "topic_id": "sumcheck_round_invariant",
     "title": "Sumcheck Round Invariant",
     "tags": ["cryptography", "zk"]
   }
   ```
   ```json
   { "tags": ["proof-systems"] }
   ```
3. `[Server -> AI]` Return created or updated topic metadata, tag membership changes, or graph-edge records.
   ```json
   {
     "topic_id": "sumcheck_round_invariant",
     "title": "Sumcheck Round Invariant",
     "tags": ["cryptography", "zk", "proof-systems"]
   }
   ```
4. `[AI -> Learner or Operator]` Confirm the ontology change.
5. `[Next.js UI -> Server]` Optionally use the same write endpoints from a graph-editing surface.
6. `[Server -> Next.js UI]` Return the updated ontology state for rendering.

## 5. Recommended Document Outline

For the main design doc, use this structure:

1. Goals and Motivations
2. Interface
3. Architecture
4. Data Model
5. Workflows
6. Server API Principles
7. Open Questions
8. Non-Goals

If a shorter version is needed, keep:

1. Goals and Motivations
2. Interface
3. Architecture
4. Workflows

and fold data-model details into Architecture.

## 6. Open Questions
- Should inferred topic proposals be stored as pending proposal objects or applied directly after approval?
- Should ontology edits and inferred ontology proposals share the same underlying change log?
- What should the exact projection rules be for updating `knowledge_score` and `coverage_score` from grade results?
- How much of quiz review should be chat-first versus UI-first?
- How should question families be modeled for cooldown and resurfacing?
