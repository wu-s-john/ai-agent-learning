CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE quiz_status AS ENUM ('created', 'in_progress', 'responses_submitted', 'review_drafted', 'finalized');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE quiz_item_outcome AS ENUM ('answered', 'skipped', 'no_answer', 'timed_out', 'abandoned', 'excluded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE response_state AS ENUM ('draft', 'submitted', 'review_drafted', 'finalized', 'excluded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE review_rating AS ENUM ('Again', 'Hard', 'Good', 'Easy');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE question_status AS ENUM ('active', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE question_modality AS ENUM ('mcq', 'free_response', 'explain_back');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE edge_type AS ENUM ('prereq_of', 'part_of', 'related_to');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE answer_reveal_policy AS ENUM ('after_each_item', 'after_quiz', 'never_in_chat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE embedding_status AS ENUM ('pending', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  overview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topics_title_idx ON topics USING gin (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS topics_title_trgm_idx ON topics USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS topic_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  alias text NOT NULL,
  CONSTRAINT topic_aliases_topic_alias_unique UNIQUE (topic_id, alias)
);
CREATE INDEX IF NOT EXISTS topic_aliases_alias_trgm_idx ON topic_aliases USING gin (alias gin_trgm_ops);

CREATE TABLE IF NOT EXISTS topic_tags (
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (topic_id, tag)
);
CREATE INDEX IF NOT EXISTS topic_tags_tag_idx ON topic_tags(tag);

CREATE TABLE IF NOT EXISTS topic_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  to_topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  edge_type edge_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_edges_unique UNIQUE (from_topic_id, to_topic_id, edge_type)
);
CREATE INDEX IF NOT EXISTS topic_edges_from_idx ON topic_edges(from_topic_id);
CREATE INDEX IF NOT EXISTS topic_edges_to_idx ON topic_edges(to_topic_id);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  prompt text NOT NULL,
  modality question_modality NOT NULL,
  status question_status NOT NULL DEFAULT 'active',
  answer_key_json jsonb,
  difficulty real NOT NULL DEFAULT 0.5,
  quality_score real NOT NULL DEFAULT 0.5,
  created_by text NOT NULL DEFAULT 'ai',
  provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_prompt_idx ON questions USING gin (to_tsvector('english', prompt));
CREATE INDEX IF NOT EXISTS questions_prompt_trgm_idx ON questions USING gin (prompt gin_trgm_ops);
CREATE INDEX IF NOT EXISTS questions_status_idx ON questions(status);

CREATE TABLE IF NOT EXISTS question_topics (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  weight real NOT NULL DEFAULT 1,
  PRIMARY KEY (question_id, topic_id)
);
CREATE INDEX IF NOT EXISTS question_topics_topic_idx ON question_topics(topic_id);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (question_id, tag)
);
CREATE INDEX IF NOT EXISTS question_tags_tag_idx ON question_tags(tag);

CREATE TABLE IF NOT EXISTS quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_type text NOT NULL DEFAULT 'standard',
  mode text NOT NULL DEFAULT 'mixed',
  status quiz_status NOT NULL DEFAULT 'created',
  purpose text,
  grading_posture text,
  difficulty_target real,
  hint_policy text,
  answer_reveal_policy answer_reveal_policy NOT NULL DEFAULT 'after_quiz',
  time_pressure_json jsonb,
  topic_ids_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
CREATE INDEX IF NOT EXISTS quizzes_user_idx ON quizzes(user_id);
CREATE INDEX IF NOT EXISTS quizzes_status_idx ON quizzes(status);

CREATE TABLE IF NOT EXISTS quiz_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  order_index integer NOT NULL,
  prompt_snapshot text NOT NULL,
  modality_snapshot question_modality NOT NULL,
  answer_key_snapshot_json jsonb,
  topic_ids_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_tags_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome quiz_item_outcome,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_items_quiz_order_unique UNIQUE (quiz_id, order_index)
);
CREATE INDEX IF NOT EXISTS quiz_items_quiz_idx ON quiz_items(quiz_id);
CREATE INDEX IF NOT EXISTS quiz_items_question_idx ON quiz_items(question_id);
CREATE INDEX IF NOT EXISTS quiz_items_outcome_idx ON quiz_items(outcome);

CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_item_id uuid NOT NULL UNIQUE REFERENCES quiz_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_text text,
  image_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_from text NOT NULL DEFAULT 'chat',
  state response_state NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS responses_user_idx ON responses(user_id);
CREATE INDEX IF NOT EXISTS responses_state_idx ON responses(state);

CREATE TABLE IF NOT EXISTS review_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL UNIQUE REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text UNIQUE,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

CREATE TABLE IF NOT EXISTS review_draft_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_draft_id uuid NOT NULL REFERENCES review_drafts(id) ON DELETE CASCADE,
  response_id uuid NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  outcome quiz_item_outcome NOT NULL,
  overall_feedback text NOT NULL DEFAULT '',
  review_rating review_rating,
  evidence_score real NOT NULL DEFAULT 0,
  strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  misconceptions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  learner_note text,
  dispute_reason text,
  excluded boolean NOT NULL DEFAULT false,
  needs_ai_re_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_draft_items_draft_idx ON review_draft_items(review_draft_id);

CREATE TABLE IF NOT EXISTS review_draft_topic_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_draft_item_id uuid NOT NULL REFERENCES review_draft_items(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  evidence_strength real NOT NULL,
  coverage_signal real NOT NULL
);

CREATE TABLE IF NOT EXISTS grade_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL UNIQUE REFERENCES responses(id) ON DELETE RESTRICT,
  review_draft_item_id uuid NOT NULL UNIQUE REFERENCES review_draft_items(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overall_feedback text NOT NULL DEFAULT '',
  review_rating review_rating,
  evidence_score real NOT NULL DEFAULT 0,
  strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  misconceptions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grade_topic_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_result_id uuid NOT NULL REFERENCES grade_results(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  evidence_strength real NOT NULL,
  coverage_signal real NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_profiles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  overview text NOT NULL DEFAULT '',
  knowledge_score real NOT NULL DEFAULT 0,
  coverage_score real NOT NULL DEFAULT 0,
  strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_misconceptions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  recent_quizzes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_reviewed_at timestamptz,
  evidence_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS user_question_state (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  last_reviewed_at timestamptz,
  due_at timestamptz,
  last_rating review_rating,
  review_count integer NOT NULL DEFAULT 0,
  cooldown_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS user_question_state_due_idx ON user_question_state(due_at);

CREATE TABLE IF NOT EXISTS user_topic_review_state (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  last_reviewed_at timestamptz,
  due_at timestamptz,
  last_rating review_rating,
  review_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX IF NOT EXISTS user_topic_review_state_due_idx ON user_topic_review_state(due_at);

CREATE TABLE IF NOT EXISTS learner_model_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  grade_result_id uuid REFERENCES grade_results(id) ON DELETE SET NULL,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'applied',
  before_knowledge real NOT NULL DEFAULT 0,
  after_knowledge real NOT NULL DEFAULT 0,
  before_coverage real NOT NULL DEFAULT 0,
  after_coverage real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  quiz_item_id uuid REFERENCES quiz_items(id) ON DELETE SET NULL,
  feedback_type text NOT NULL,
  feedback_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_type text NOT NULL,
  topic_json jsonb,
  edge_json jsonb,
  tags_json jsonb,
  reason text NOT NULL DEFAULT '',
  supporting_signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status proposal_status NOT NULL DEFAULT 'pending',
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS reference_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  title text NOT NULL,
  path_or_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES reference_sources(id) ON DELETE CASCADE,
  heading text,
  chunk_text text NOT NULL,
  snippet text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  embedding_model text NOT NULL,
  text_hash text NOT NULL,
  embedding_status embedding_status NOT NULL DEFAULT 'pending',
  embedding vector(1536),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_embeddings_unique UNIQUE (topic_id, embedding_model)
);

CREATE TABLE IF NOT EXISTS question_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  embedding_model text NOT NULL,
  text_hash text NOT NULL,
  embedding_status embedding_status NOT NULL DEFAULT 'pending',
  embedding vector(1536),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_embeddings_unique UNIQUE (question_id, embedding_model)
);

CREATE TABLE IF NOT EXISTS reference_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_chunk_id uuid NOT NULL REFERENCES reference_chunks(id) ON DELETE CASCADE,
  embedding_model text NOT NULL,
  text_hash text NOT NULL,
  embedding_status embedding_status NOT NULL DEFAULT 'pending',
  embedding vector(1536),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reference_embeddings_unique UNIQUE (reference_chunk_id, embedding_model)
);

CREATE INDEX IF NOT EXISTS topic_embeddings_vector_idx ON topic_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS question_embeddings_vector_idx ON question_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS reference_embeddings_vector_idx ON reference_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, key)
);
