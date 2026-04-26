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
- Learners can choose when answers/feedback are revealed in chat with `answer_reveal_policy`.

Primary docs:
- `docs/design.md`: product goals, architecture, data model, workflows
- `docs/server-endpoints.md`: API endpoints, request/response shapes, server responsibilities

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
- keep skipped, no-answer, timed-out, and abandoned outcomes distinct from never-presented quiz items
- respect `answer_reveal_policy`, especially `after_quiz` and `never_in_chat`

When in doubt:
- `quiz-conductor` owns live challenge flow
- `assessment-reviewer` owns grading and finalization
- `knowledge-modeler` owns model inspection, gap reasoning, and ontology curation
