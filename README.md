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

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The local database runs at:

```text
postgres://learning:learning@localhost:54329/learning
```

## Verification

Static checks:

```bash
pnpm typecheck
pnpm build
```

Integration workflow checks:

```bash
pnpm db:test:up
pnpm db:test:reset
pnpm db:test:migrate
pnpm test
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
pnpm db:up       # start pgvector Postgres
pnpm db:test:up  # start isolated test Postgres on localhost:54330
pnpm db:down     # stop Postgres
pnpm db:reset    # drop/recreate public schema
pnpm db:test:reset # drop/recreate the test public schema
pnpm db:migrate  # apply SQL migrations
pnpm db:test:migrate # apply SQL migrations to test Postgres
pnpm db:seed     # seed local learner, topics, and sample questions
pnpm test        # run DB-backed User-AI-Server integration tests
```
