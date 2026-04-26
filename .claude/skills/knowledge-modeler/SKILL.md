---
name: knowledge-modeler
description: Use when inspecting the learner model, finding gaps, explaining progress, inferring ontology/tag/topic recommendations, curating the topic graph, or doing optional reference lookup.
---

# Knowledge Modeler

## Role

Interpret the learner model and topic graph. The server retrieves and stores; this role reasons over profiles, activity, review state, questions, and graph edges.

Use this role for:
- inspect topic
- find gaps
- inspect learning progress
- infer ontology recommendations
- curate ontology graph
- optional reference lookup

## Core API Calls

Topic/profile reads:
- `GET /api/topics?q=...&limit=...`
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`
- `POST /api/learner/snapshot`

Activity and progress reads:
- `GET /api/activity?topic_id=...&limit=...`
- `GET /api/review-items?topic_id=...&limit=...`
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `GET /api/quizzes?topic_id=...&limit=...`
- `GET /api/progress/overview`

Ontology writes:
- `POST /api/topics`
- `PATCH /api/topics/:topicId`
- `POST /api/topics/:topicId/tags`
- `DELETE /api/topics/:topicId/tags/:tag`
- `POST /api/topic-edges`
- `DELETE /api/topic-edges/:edgeId`

Optional proposal persistence:
- `POST /api/topic-proposals`
- `GET /api/topic-proposals?status=pending`
- `POST /api/topic-proposals/:proposalId/decision`

Optional references:
- `GET /api/references?q=...&limit=...`

## Workflow: Inspect Topic

1. Resolve the topic with `GET /api/topics`.
2. Fetch profile with `GET /api/topics/:topicId/profile`.
3. Fetch graph neighborhood with `GET /api/topics/:topicId/edges` when helpful.
4. Explain:
   - current `knowledge_score`
   - current `coverage_score`
   - strengths
   - weaknesses
   - misconceptions
   - recent quiz evidence
   - nearby topics worth challenging next

Make clear when a topic is weak because of low mastery versus uncertain because of low coverage.

## Workflow: Find Gaps

Do not call a smart gap endpoint. Derive gaps from dumb server reads.

1. Resolve broad topic/tag scope.
2. Fetch profiles and graph neighbors.
3. Fetch activity, review items, question history, and recent quizzes.
4. Infer:
   - weak topics
   - underexplored topics
   - likely prerequisite blockers
   - repeated misconception patterns
   - good next quiz targets

Prefer recommending a diagnostic quiz when evidence is sparse.

## Workflow: Inspect Learning Progress

1. Read `GET /api/progress/overview`.
2. Explain strongest topics, weakest topics, underexplored topics, most reviewed topics, and recent misconception patterns.
3. Call out trust level:
   - high coverage + low knowledge means likely real gap
   - low coverage means uncertainty and calls for diagnostic probing

## Workflow: Infer and Curate Ontology

Infer recommendations from:
- repeated quiz misses
- activity patterns
- low scores in related/prereq topics
- questions that repeatedly produce evidence for untracked concepts

Possible proposals:
- add topic
- modify topic metadata
- add/remove tag
- add/remove `prereq_of`, `part_of`, or `related_to` edge

Ask for approval before writes unless the user explicitly requested a direct edit.

Use proposal persistence only when pending review in the UI is useful; otherwise write approved changes directly through topic/tag/edge endpoints.

## Workflow: Reference Lookup

Reference lookup is secondary. Use it only when the learner asks for saved notes/sources or when grounding an explanation would materially help.

Do not let reference lookup replace quiz evidence or learner-model inspection.
