# UI Design

## 1. Purpose

The Next.js UI is a separate inspection and control layer from the AI-server workflows.

The chat agent remains the primary learning interface. The UI exists for tasks that benefit from a visual surface:
- reviewing quiz results
- inspecting responses and feedback
- finalizing staged assessment evidence
- inspecting topic profiles and ontology graph neighborhoods
- viewing overall learning progress
- approving or applying ontology changes

The UI should call the same dumb server APIs as the AI. It should not perform AI reasoning.

## 2. Navigation Contract

When the AI points the learner to a page, it should use:

```text
http://<tailscale-host>:<port>/<path>
```

Prefer Tailscale MagicDNS when available:

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

Rules:
- The AI can link to UI pages when inspection, editing, finalization, graph browsing, or approval is useful.
- The AI should not require UI for chat-native flows like answering quiz items.
- The UI should not hide important model state. Show whether data is draft, finalized, excluded, disputed, or pending re-review.

## 3. Route Summary

| Route | Purpose | Primary APIs |
| --- | --- | --- |
| `/quizzes/:quizId/results` | Review draft results before finalization and inspect finalized results after finalization | `GET /api/quizzes/:quizId/review-draft`, `PATCH /api/quizzes/:quizId/review-draft`, `POST /api/quizzes/:quizId/review-draft/finalize`, `GET /api/quizzes/:quizId/results`, `POST /api/quizzes/:quizId/feedback` |
| `/topics/:topicId` | Inspect one topic profile and its local ontology graph | `GET /api/topics/:topicId/profile`, `GET /api/topics/:topicId/edges` |
| `/progress` | Decide what to challenge next across all tracked topics | `GET /api/progress/overview` |
| `/ontology/proposals` | Review AI-authored ontology/tag/edge proposals | `GET /api/topic-proposals?status=pending`, `POST /api/topic-proposals/:proposalId/decision` |
| `/ontology` | Browse and curate topics, tags, and edges | `GET /api/topics`, `POST /api/topics`, `PATCH /api/topics/:topicId`, tag endpoints, edge endpoints |

## 4. `/quizzes/:quizId/results`

This is one page with two states.

### Draft Review State

Use when quiz status is `review_drafted`.

APIs:
- `GET /api/quizzes/:quizId/review-draft`
- `PATCH /api/quizzes/:quizId/review-draft`
- `POST /api/quizzes/:quizId/review-draft/finalize`

Purpose:
- inspect questions
- inspect learner responses and item outcomes
- inspect AI feedback, proposed ratings, and topic evidence
- add learner notes or dispute reasons
- exclude invalid items
- finalize the review

Recommended layout:
- Header: quiz title/scope, status badge `Draft Review`, purpose, date, optional `answer_reveal_policy`.
- Warning banner: “Scores are not applied until you finalize.”
- Summary card: overview, strengths, weaknesses, improvement targets.
- Item list: prompt, answer/outcome, feedback, proposed rating, topic evidence, exclusion state, dispute state.
- Right rail or sticky footer: finalize button, disabled if any non-excluded item has `needs_ai_re_review`.

Allowed learner edits:
- `overall_feedback`
- `learner_note`
- `dispute_reason`
- `excluded`

Do not allow direct learner edits to:
- `review_rating`
- `evidence_score`
- `topic_evidence`

If the learner disputes evidence, mark the item for AI re-review rather than letting the learner self-grade.

### Finalized Results State

Use when quiz status is `finalized`.

APIs:
- `GET /api/quizzes/:quizId/results`
- `POST /api/quizzes/:quizId/feedback`

Purpose:
- inspect immutable grades
- inspect topic updates
- inspect strengths, weaknesses, and improvement targets
- submit additive feedback
- start a follow-up quiz

Recommended layout:
- Header: status badge `Finalized`, finalized time, quiz purpose.
- Summary: overview, strengths, weaknesses, improvement targets.
- Evidence cards: rating counts, outcome counts, topic deltas.
- Item list: prompt, answer/outcome, final feedback, immutable rating, topic evidence.
- Feedback form: “Was anything wrong, confusing, or unfair?”
- CTA: start follow-up quiz.

## 5. `/topics/:topicId`

This is the primary model-inspection page for one topic.

APIs:
- `GET /api/topics/:topicId/profile`
- `GET /api/topics/:topicId/edges`

Use React Flow for the graph.

Graph model:
- each node is a topic
- selected topic is centered
- immediate prerequisites, parts, and related topics surround it
- side panel shows details for the selected node

Visual encoding:
- node fill color = `knowledge_score`
- node border thickness or opacity = `coverage_score`
- small badge or dot = due / review-needed state
- warning indicator = active misconception
- `prereq_of` edge = directed arrow
- `part_of` edge = solid line
- `related_to` edge = dashed line

Recommended layout:
- Header: topic title, tags, score badges.
- Main area: React Flow focus graph.
- Side panel: overview, strengths, weaknesses, misconceptions, recent quizzes, next recommended topics.
- Actions: start quiz, find gaps nearby, open related topic.

React Flow implementation notes:
- import from `@xyflow/react`
- import `@xyflow/react/dist/style.css`
- give the graph container explicit width and height
- use custom topic nodes
- keep `nodeTypes` and `edgeTypes` stable
- use the local `react-flow` skill when implementing or debugging this page

## 6. `/progress`

This page should help decide what to challenge next. It should not become a vanity stats page.

API:
- `GET /api/progress/overview`

Recommended sections:
- overall snapshot
- strongest topics
- weakest topics
- underexplored topics
- most reviewed topics
- recent misconception patterns
- suggested next challenges

Top cards:
- topics tracked
- quizzes completed
- average knowledge score
- average coverage score
- recent review count

Primary visualization:
- scatter plot of topics
- x-axis = `coverage_score`
- y-axis = `knowledge_score`
- point = topic
- color = tag/subject
- size = review count
- click point -> `/topics/:topicId`

Interpretation:
- top-right: strong evidence of mastery
- bottom-right: known weak spots
- bottom-left: unknown or underexplored
- top-left: promising but low-confidence

Recommended supporting panels:
- weak but well-covered: likely real gaps
- low coverage: needs diagnostic probing
- strong and well-covered: likely safe to advance from
- stale / due soon: needs resurfacing

## 7. `/ontology/proposals`

This page is for reviewing AI-authored ontology proposals.

APIs:
- `GET /api/topic-proposals?status=pending`
- `POST /api/topic-proposals/:proposalId/decision`

Recommended layout:
- proposal queue grouped by proposal type
- supporting signals and reason
- approve / reject actions
- preview of affected topic or edge

Proposal types:
- add topic
- modify topic
- add tag
- remove tag
- add edge
- remove edge

The server stores proposals. The AI infers them.

## 8. `/ontology`

This is the manual graph curation page.

APIs:
- `GET /api/topics?q=...&limit=...`
- `POST /api/topics`
- `PATCH /api/topics/:topicId`
- `POST /api/topics/:topicId/tags`
- `DELETE /api/topics/:topicId/tags/:tag`
- `POST /api/topic-edges`
- `DELETE /api/topic-edges/:edgeId`

Recommended layout:
- searchable topic list
- selected topic editor
- tag editor
- edge editor
- compact graph preview

The UI can use React Flow here too, but `/topics/:topicId` should be the first graph experience.

## 9. Design Principles

- Prefer inspection over decoration.
- Make draft versus finalized state obvious.
- Do not hide uncertainty. Low coverage means “we do not know enough yet.”
- Keep actions close to evidence.
- Use color and size sparingly; always pair visual encodings with text labels.
- Use links that the AI can share directly in chat.
- Keep reference lookup secondary to learner-model inspection.
