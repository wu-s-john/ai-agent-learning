# AI Agent Learning

This app is a quiz-first AI learning system. Its purpose is to challenge a learner, collect durable assessment evidence, and maintain an inspectable model of what the learner appears to know.

The main interface is a single chat AI agent. The agent is not split into multiple services. Instead, it uses a few local role-skills depending on the workflow.

Core philosophy:
- Challenge first, teach second.
- Learner responses are the main evidence source.
- The server stores, retrieves, validates, and computes deterministic projections.
- The AI interprets, grades, plans quizzes, and infers gaps.
- Grades and learner-model evidence become immutable after review finalization.
- Questions may be AI-created and stored as normal active questions; quality is handled later through feedback, edits, or retirement.
- Questions use flexible `question_tags`; the MVP does not store rubrics.
- Learners can choose when answers/feedback are revealed in chat with `answer_reveal_policy`.

Primary docs:
- `docs/design.md`: product goals, architecture, data model, workflows
- `docs/server-endpoints.md`: API endpoints, request/response shapes, server responsibilities
- `docs/ui-design.md`: Next.js page design, UI navigation, graph visualization, dashboard layout

## UI Navigation

When pointing the learner to a Next.js page, use:

```text
http://<tailscale-host>:<port>/<path>
```

Prefer the Tailscale MagicDNS name when available:

```bash
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'
```

Fallback to the Tailscale IPv4 address:

```bash
tailscale ip -4
```

Example:

```text
http://my-mac.tailnet-name.ts.net:3000/quizzes/quiz_001/results
```

## Skill Directory

Use these role-skills from `.claude/skills`.

### `quiz-conductor`

Use for live quiz work:
- start quiz
- run quiz item
- explain-back quiz
- diagnostic quiz
- interview-simulation quiz
- submit quiz responses

Main endpoints:
- `GET /api/topics?q=...&limit=...`
- `POST /api/learner/snapshot`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `POST /api/questions`
- `POST /api/quizzes`
- `GET /api/quizzes/:quizId/items`
- `GET /api/quiz-items/:quizItemId`
- `POST /api/quiz-items/:quizItemId/response-draft`
- `POST /api/quizzes/:quizId/responses/submit`

### `assessment-reviewer`

Use for grading and review lifecycle:
- draft quiz review
- show draft review or finalized results
- handle learner disputes
- perform AI re-review
- finalize immutable grades
- explain quiz results
- submit quiz feedback

Main endpoints:
- `GET /api/responses/:responseId`
- `GET /api/responses/:responseId/grades`
- `POST /api/quizzes/:quizId/review-draft`
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `POST /api/quizzes/:quizId/review-draft/finalize`
- `GET /api/quizzes/:quizId/results`
- `POST /api/quizzes/:quizId/feedback`

### `knowledge-modeler`

Use for learner-model and ontology work:
- inspect topic
- find gaps
- inspect learning progress
- infer ontology recommendations
- curate topics/tags/edges
- optional reference lookup

Main endpoints:
- `GET /api/topics?q=...&limit=...`
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`
- `POST /api/learner/snapshot`
- `GET /api/activity?topic_id=...&limit=...`
- `GET /api/review-items?topic_id=...&limit=...`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `GET /api/quizzes?topic_id=...&limit=...`
- `GET /api/progress/overview`
- `POST /api/topics`
- `PATCH /api/topics/:topicId`
- `POST /api/topics/:topicId/tags`
- `DELETE /api/topics/:topicId/tags/:tag`
- `POST /api/topic-edges`
- `DELETE /api/topic-edges/:edgeId`
- optional `GET /api/references?q=...&limit=...`

### `react-flow`

Use for React Flow graph UI work:
- rendering the `/topics/:topicId` topic graph
- building custom topic nodes and graph edges
- styling learner-state overlays on nodes
- wiring graph interactivity, side panels, and layout
- debugging React Flow canvas, handle, edge, or performance issues

Main use cases:
- import from `@xyflow/react`
- render topic graph nodes colored by `knowledge_score`
- style node border or opacity by `coverage_score`
- show badges for due/review-needed state
- show warning indicators for active misconceptions
- style edges by `prereq_of`, `part_of`, and `related_to`

## Operating Rules

Before making architectural changes, check both design docs.

When changing API contracts:
- update `docs/server-endpoints.md`
- update workflow references in `docs/design.md`
- update the relevant local skill if its role or endpoint list changes

When changing learning semantics:
- preserve the dumb-server / smart-AI split
- keep learner-model updates deterministic at finalization time
- do not let learner-edited ratings directly become mastery evidence
- generate and preserve useful question tags when creating questions
- do not depend on stored rubrics in the MVP
- keep skipped, no-answer, timed-out, and abandoned outcomes distinct from never-presented quiz items
- save `no_answer` as soon as a quiz item is shown, then update that draft if the learner answers
- respect `answer_reveal_policy`, especially `after_quiz` and `never_in_chat`

When adding tests:
- write integration tests only; do not add isolated unit tests for helpers or schemas
- model tests as `User -> AI -> Server` workflow stories from `docs/design.md`
- use fixture data for the learner/user actions and fixture JSON for the AI actor's planning, review, and grading outputs
- interact with the real backend persistence layer and real test Postgres, but test product workflows rather than Postgres behavior
- keep the development and test databases on different ports: dev Postgres uses `localhost:54329`, test Postgres uses `localhost:54330`
- prefer readable actor-step comments such as `[User -> AI]`, `[AI -> Server]`, and `[Server -> AI]`

Example integration-test shape:

```ts
it("models a full quiz where the AI uses fixture review JSON and the server updates learner knowledge", async () => {
  // [User -> AI] "Quiz me on compactness."
  // [AI -> Server] Create topic/question/quiz.
  const quiz = await createQuiz(...);

  // [AI -> Server] Mark shown question as no_answer.
  await saveResponseDraft(item.quiz_item_id, { outcome: "no_answer", answer_text: null });

  // [User -> AI] Learner answers.
  // [AI -> Server] Save durable draft.
  const answeredDraft = await saveResponseDraft(item.quiz_item_id, {
    outcome: "answered",
    answer_text: "Every open cover has a finite subcover."
  });

  // [AI -> Server] Submit quiz responses.
  const submitted = await submitQuizResponses(quiz.quiz_id, ...);

  // [AI -> AI] Fixture JSON stands in for LLM grading/review.
  // [AI -> Server] Store review draft.
  await createReviewDraft(quiz.quiz_id, {
    items: [{
      response_id: answeredDraft.response_id,
      review_rating: "Good",
      evidence_score: 0.82,
      topic_evidence: [{ topic_id: "compactness", evidence_strength: 0.82, coverage_signal: 0.4 }]
    }]
  });

  // [UI -> Server] Finalize, then assert learner model changed.
  await finalizeReviewDraft(quiz.quiz_id, ...);
  const profile = await getTopicProfile("compactness");

  expect(profile.knowledge_score).toBeGreaterThan(0);
});
```

When in doubt:
- `quiz-conductor` owns live challenge flow
- `assessment-reviewer` owns grading and finalization
- `knowledge-modeler` owns model inspection, gap reasoning, and ontology curation
