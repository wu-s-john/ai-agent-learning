---
name: assessment-reviewer
description: Use when grading submitted quiz responses, creating staged review drafts, handling learner disputes, finalizing immutable grades, explaining quiz results, or storing quiz feedback.
---

# Assessment Reviewer

## Role

Turn submitted quiz responses into staged assessment evidence, let the learner review that evidence safely, and finalize immutable grades.

Use this role for:
- draft quiz review
- show draft review or finalized results
- handle skipped/no-answer/timed-out outcomes
- handle learner disputes and AI re-review
- finalize review draft
- explain quiz results
- submit quiz feedback

Do not directly write canonical `knowledge_delta` or `coverage_delta`. The server computes learner-model updates when a review draft is finalized.

## Core API Calls

Use API schemas from `docs/server-endpoints.md`.

Response and grade reads:
- `GET /api/responses/:responseId`
- `GET /api/responses/:responseId/grades`

Review draft lifecycle:
- `POST /api/quizzes/:quizId/review-draft`
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `POST /api/quizzes/:quizId/review-draft/finalize`

Results and feedback:
- `GET /api/quizzes/:quizId/results`
- `POST /api/quizzes/:quizId/feedback`
- `GET /api/learner-model/updates?status=...&limit=...`

## Canonical Evidence Schema

Use this schema consistently in review drafts:
- `response_id`: submitted response being reviewed
- `outcome`: stored quiz item outcome; must match the server-side outcome exactly
- `review_rating`: `Again`, `Hard`, `Good`, or `Easy`
- `evidence_score`: overall evaluation confidence, from `0` to `1`
- `topic_evidence[].topic_id`: existing topic ID
- `topic_evidence[].evidence_strength`: evidence for current knowledge, from `0` to `1`
- `topic_evidence[].coverage_signal`: topic coverage explored by this item, from `0` to `1`
- `excluded`: whether this item should be ignored by learner-model projections
- `needs_ai_re_review`: whether a learner dispute requires revised AI evidence before finalization

Server validation rules:
- each `response_id` may appear at most once in a review draft
- each reviewed response must belong to the quiz being reviewed
- each reviewed response must already be submitted or review-drafted
- each review item `outcome` must match the stored quiz item outcome
- non-excluded items require `review_rating` and at least one `topic_evidence` row
- excluded items may omit `review_rating`, `evidence_score`, and `topic_evidence`
- empty review drafts may be staged, but cannot be finalized

## Workflow: Draft Quiz Review

Input is the `review_payload` from `POST /api/quizzes/:quizId/responses/submit`.

1. Grade each submitted item using the question prompt, linked topics, question tags, optional answer key, modality, outcome, and learner response.
2. Include skipped, no-answer, timed-out, and abandoned outcomes in the review draft.
3. Create a top-level summary with `overview`, `strengths`, `weaknesses`, and `improvement_targets`.
4. Store staged evidence with `POST /api/quizzes/:quizId/review-draft`.

When creating or replacing a review draft, include every item that should be finalized later. Replacing a draft removes the previous staged draft and omitted responses return to `submitted` state.

Outcome guidance:
- `answered`: grade correctness and produce topic evidence.
- `skipped`: usually weak negative evidence or coverage-only evidence, depending on context.
- `no_answer`: evidence that the presented item was not answered; avoid over-penalizing without context.
- `timed_out`: useful for interview/time-pressure diagnosis; mention timing separately from conceptual mastery.
- `abandoned`: usually do not treat as strong knowledge evidence unless the quiz context makes that meaningful.
- `excluded`: do not contribute to learner-model updates and may omit rating/evidence.

## Workflow: Show Results / Review Draft

The quiz results page has two states:
- draft review state: use `GET /api/quizzes/:quizId/review-draft`
- finalized results state: use `GET /api/quizzes/:quizId/results`

In draft review state, show questions, responses, outcomes, AI feedback, proposed ratings, topic evidence, exclusions, and dispute status.

In finalized results state, explain immutable grades, topic deltas, strengths, weaknesses, and recommended follow-up challenges.

## Workflow: Dispute and Re-Review

Learner-originated edits may update:
- display feedback
- learner notes
- dispute reason
- exclusion flag

Learners must not directly edit:
- `review_rating`
- `evidence_score`
- `topic_evidence`

If the learner disputes assessment evidence:
1. Save the dispute with `PATCH /api/quizzes/:quizId/review-draft`.
2. Re-read the review draft with `GET /api/quizzes/:quizId/review-draft`.
3. Reassess disputed items.
4. Submit a replacement review draft containing all items that should remain staged, with revised evidence and `needs_ai_re_review: false` for resolved items.

Finalization should not proceed while any non-excluded item has `needs_ai_re_review: true` or while the review draft has zero items.

## Workflow: Finalize Quiz Review

1. Finalize with `POST /api/quizzes/:quizId/review-draft/finalize`.
2. Read final results with `GET /api/quizzes/:quizId/results`.
3. Explain the result to the learner:
   - what was strong
   - what was weak
   - what remains underexplored
   - what to challenge next

Use `POST /api/quizzes/:quizId/feedback` for later learner feedback. Feedback is additive and does not mutate finalized grades.
