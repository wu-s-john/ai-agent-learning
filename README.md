# AI Agent Learning

Quiz-first backend for AI agents that uncover what you know and challenge you with better quizzes.

This repo is for building a learning system where AI agents use quizzes to discover a learner's knowledge set, find gaps, and generate sharper follow-up challenges based on evidence. The app is not primarily a passive teaching tool. It is a challenge-first system for checking mastery, simulating interviews, diagnosing weak spots, and growing a durable learner model over time.

The backend stores the durable pieces the AI needs:
- topics, tags, and ontology edges
- questions and quiz item snapshots
- learner responses and quiz outcomes
- staged review feedback and immutable finalized grades
- deterministic topic-profile projections

This repository currently implements the non-UI backend:
- Next.js App Router API routes
- Drizzle schema and migration
- Dockerized Postgres with pgvector
- deterministic learner-model projections
- question tags instead of question families
- no stored rubrics for the MVP

## Docs

The `/docs` folder has the product and API design details:
- [`docs/design.md`](docs/design.md) explains the goals, learner model, AI/server split, workflows, and graph visualization ideas.
- [`docs/server-endpoints.md`](docs/server-endpoints.md) documents the API endpoints, request/response shapes, and AI-server interactions.
- [`docs/ui-design.md`](docs/ui-design.md) sketches the future Next.js inspection surfaces for quiz results, topic profiles, progress, and graphs.

## Quick Start

Local Docker workflow:

```bash
pnpm install
just db-up-local
just db-migrate-local
just db-seed-local
just dev
```

The local development database runs at:

```text
postgres://learning:learning@localhost:54329/learning
```

The local test database runs at:

```text
postgres://learning:learning@localhost:54330/learning
```

See [`docs/aws-rds.md`](docs/aws-rds.md) for the AWS RDS production deployment,
migration, and release command flow.

Production commands use 1Password refs hydrated into local `.env`:

```bash
just load-dev-token
just setup-env
just check-env-prod
```

## Verification

Static checks:

```bash
pnpm typecheck
pnpm build
```

Integration workflow checks:

```bash
just test
```

This repo intentionally uses integration tests only. The tests connect to real Postgres on `localhost:54330` and model the `User -> AI -> Server` workflows described in [`docs/design.md`](docs/design.md).

The DB lifecycle tests use fixture JSON for the AI review/grading step. Those fixtures act as the LLM actor in tests: they are deterministic and fast, while still matching the shape of the real end-to-end quiz flow where an AI plans, reviews, and submits feedback through the API.

The development database remains separate on `localhost:54329`, so test resets do not wipe local development data.

## Backend Rules

- The server stores, retrieves, validates, and computes deterministic projections.
- The AI plans quizzes, grades responses, infers gaps, and explains results.
- Questions use `question_tags`; the MVP does not store rubrics.
- When the AI shows a quiz item, it saves `outcome: "no_answer"` through `response-draft`.
- Finalized grades and learner-model evidence are immutable.
- Later corrections are additive feedback/proposal events, not in-place grade edits.

## Useful Scripts

```bash
just db-up-local       # start local dev Postgres on localhost:54329
just db-up-test        # start local test Postgres on localhost:54330
just db-migrate-local  # apply SQL migrations to local dev
just db-migrate-test   # apply SQL migrations to local test
just db-seed-local     # seed local learner, topics, and sample questions
just test              # run DB-backed integration tests against local test DB
just load-dev-token    # seed local access to ai-agent-army-dev secrets
just setup-env         # hydrate prod/RDS env refs into .env
```
