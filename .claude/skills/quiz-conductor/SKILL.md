---
name: quiz-conductor
description: Use when starting, running, or submitting quiz-first learning sessions. Owns quiz planning, question selection/creation, live item presentation, durable response/outcome capture, explain-back quizzes, diagnostic quizzes, and interview-simulation quizzes.
---

# Quiz Conductor

## Role

Run the live challenge experience. The product is quiz-first: challenge the learner, capture evidence, and avoid turning the session into a passive lesson.

Use this role for:
- start quiz
- run quiz item
- explain-back quiz
- diagnostic quiz
- interview-simulation quiz
- submit quiz responses

Do not grade final answers or update the learner model in this role. Hand submitted responses to the Assessment Reviewer role.

## Core API Calls

Use API schemas from `docs/server-endpoints.md`.

Topic and learner context:
- `GET /api/topics?q=...&limit=...`
- `POST /api/learner/snapshot`

Question retrieval and creation:
- `GET /api/questions?q=...&topic_id=...&limit=...`
- `POST /api/questions`

Quiz creation and item reads:
- `POST /api/quizzes`
- `GET /api/quizzes/:quizId`
- `GET /api/quizzes/:quizId/items`
- `GET /api/quiz-items/:quizItemId`

Live answer capture:
- `POST /api/quiz-items/:quizItemId/response-draft`
- `POST /api/quizzes/:quizId/responses/submit`

## Workflow: Start Quiz

1. Resolve topic or tag scope with `GET /api/topics`.
2. Fetch raw learner state with `POST /api/learner/snapshot`.
3. Search existing questions with `GET /api/questions`.
4. Create new questions with `POST /api/questions` only when retrieval does not provide enough useful coverage.
5. Create the quiz with `POST /api/quizzes`.
6. Present the first ordered quiz item.

Optional quiz metadata:
- `purpose`: `mastery`, `diagnosis`, `interview_simulation`, `model_building`, or similar
- `grading_posture`: `lenient`, `normal`, `strict`
- `difficulty_target`: number from `0` to `1`
- `hint_policy`: for example `no_hints`, `minimal_hints`, `allow_hints`
- `time_pressure`: nullable metadata for timed/interview-like quizzes
- `answer_reveal_policy`: `after_each_item`, `after_quiz`, or `never_in_chat`

## Workflow: Run Quiz Item

Before or when showing an item, ensure the item can be distinguished from never-shown items later. Prefer creating/updating a draft outcome as soon as the item is presented.

For every presented item, save one of these outcomes through `POST /api/quiz-items/:quizItemId/response-draft`:
- `answered`
- `skipped`
- `no_answer`
- `timed_out`
- `abandoned`
- `excluded`

Rules:
- Save `answered` with `answer_text` and optional `image_refs`.
- Save `skipped`, `no_answer`, `timed_out`, or `abandoned` with `answer_text: null`.
- If the learner asks not to reveal answers until the end, set or preserve `answer_reveal_policy: "after_quiz"`.
- If `answer_reveal_policy` is `after_quiz` or `never_in_chat`, do not reveal correctness, answer keys, or grading feedback during the live chat.
- Do not call grading endpoints during the live quiz.
- Advance through the ordered quiz item list locally; there is no `/next` endpoint in V1.

## Workflow: Submit Quiz Responses

When the learner finishes or stops early:
1. Ensure all presented items have a saved outcome.
2. Call `POST /api/quizzes/:quizId/responses/submit` with an idempotency key.
3. Pass the returned `review_payload` to the Assessment Reviewer role.

Do not finalize or mutate the learner model from this role.

## Output Style

Keep the learner experience focused:
- ask one question at a time
- explain why a question was chosen only when useful
- avoid revealing answer keys or grading expectations before the learner answers
- respect `answer_reveal_policy` exactly
- do not over-teach unless the learner asks
