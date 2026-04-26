import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    if (typeof value !== "string") return [];
    return value
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .filter(Boolean)
      .map(Number);
  }
});

export const quizStatusEnum = pgEnum("quiz_status", [
  "created",
  "in_progress",
  "responses_submitted",
  "review_drafted",
  "finalized"
]);

export const quizItemOutcomeEnum = pgEnum("quiz_item_outcome", [
  "answered",
  "skipped",
  "no_answer",
  "timed_out",
  "abandoned",
  "excluded"
]);

export const responseStateEnum = pgEnum("response_state", [
  "draft",
  "submitted",
  "review_drafted",
  "finalized",
  "excluded"
]);

export const reviewRatingEnum = pgEnum("review_rating", ["Again", "Hard", "Good", "Easy"]);
export const questionStatusEnum = pgEnum("question_status", ["active", "retired"]);
export const questionModalityEnum = pgEnum("question_modality", ["mcq", "free_response", "explain_back"]);
export const edgeTypeEnum = pgEnum("edge_type", ["prereq_of", "part_of", "related_to"]);
export const answerRevealPolicyEnum = pgEnum("answer_reveal_policy", [
  "after_each_item",
  "after_quiz",
  "never_in_chat"
]);
export const embeddingStatusEnum = pgEnum("embedding_status", ["pending", "ready", "failed"]);
export const proposalStatusEnum = pgEnum("proposal_status", ["pending", "approved", "rejected"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    overview: text("overview").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    titleIdx: index("topics_title_idx").using("gin", sql`to_tsvector('english', ${table.title})`),
    titleTrgmIdx: index("topics_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`)
  })
);

export const topicAliases = pgTable(
  "topic_aliases",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    alias: text("alias").notNull()
  },
  (table) => ({
    uniqueAlias: unique("topic_aliases_topic_alias_unique").on(table.topicId, table.alias),
    aliasTrgmIdx: index("topic_aliases_alias_trgm_idx").using("gin", sql`${table.alias} gin_trgm_ops`)
  })
);

export const topicTags = pgTable(
  "topic_tags",
  {
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    tag: text("tag").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.topicId, table.tag] }),
    tagIdx: index("topic_tags_tag_idx").on(table.tag)
  })
);

export const topicEdges = pgTable(
  "topic_edges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    fromTopicId: uuid("from_topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    toTopicId: uuid("to_topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    edgeType: edgeTypeEnum("edge_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueEdge: unique("topic_edges_unique").on(table.fromTopicId, table.toTopicId, table.edgeType),
    fromIdx: index("topic_edges_from_idx").on(table.fromTopicId),
    toIdx: index("topic_edges_to_idx").on(table.toTopicId)
  })
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique(),
    prompt: text("prompt").notNull(),
    modality: questionModalityEnum("modality").notNull(),
    status: questionStatusEnum("status").notNull().default("active"),
    answerKeyJson: jsonb("answer_key_json"),
    difficulty: real("difficulty").notNull().default(0.5),
    qualityScore: real("quality_score").notNull().default(0.5),
    createdBy: text("created_by").notNull().default("ai"),
    provenanceJson: jsonb("provenance_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    promptIdx: index("questions_prompt_idx").using("gin", sql`to_tsvector('english', ${table.prompt})`),
    promptTrgmIdx: index("questions_prompt_trgm_idx").using("gin", sql`${table.prompt} gin_trgm_ops`),
    statusIdx: index("questions_status_idx").on(table.status)
  })
);

export const questionTopics = pgTable(
  "question_topics",
  {
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    weight: real("weight").notNull().default(1)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.questionId, table.topicId] }),
    topicIdx: index("question_topics_topic_idx").on(table.topicId)
  })
);

export const questionTags = pgTable(
  "question_tags",
  {
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    tag: text("tag").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.questionId, table.tag] }),
    tagIdx: index("question_tags_tag_idx").on(table.tag)
  })
);

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    quizType: text("quiz_type").notNull().default("standard"),
    mode: text("mode").notNull().default("mixed"),
    status: quizStatusEnum("status").notNull().default("created"),
    purpose: text("purpose"),
    gradingPosture: text("grading_posture"),
    difficultyTarget: real("difficulty_target"),
    hintPolicy: text("hint_policy"),
    answerRevealPolicy: answerRevealPolicyEnum("answer_reveal_policy").notNull().default("after_quiz"),
    timePressureJson: jsonb("time_pressure_json"),
    topicIdsSnapshot: jsonb("topic_ids_snapshot").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
  },
  (table) => ({
    userIdx: index("quizzes_user_idx").on(table.userId),
    statusIdx: index("quizzes_status_idx").on(table.status)
  })
);

export const quizItems = pgTable(
  "quiz_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    orderIndex: integer("order_index").notNull(),
    promptSnapshot: text("prompt_snapshot").notNull(),
    modalitySnapshot: questionModalityEnum("modality_snapshot").notNull(),
    answerKeySnapshotJson: jsonb("answer_key_snapshot_json"),
    topicIdsSnapshot: jsonb("topic_ids_snapshot").notNull().default(sql`'[]'::jsonb`),
    questionTagsSnapshot: jsonb("question_tags_snapshot").notNull().default(sql`'[]'::jsonb`),
    outcome: quizItemOutcomeEnum("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueOrder: unique("quiz_items_quiz_order_unique").on(table.quizId, table.orderIndex),
    quizIdx: index("quiz_items_quiz_idx").on(table.quizId),
    questionIdx: index("quiz_items_question_idx").on(table.questionId),
    outcomeIdx: index("quiz_items_outcome_idx").on(table.outcome)
  })
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    quizItemId: uuid("quiz_item_id").notNull().references(() => quizItems.id, { onDelete: "cascade" }).unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    answerText: text("answer_text"),
    imageRefsJson: jsonb("image_refs_json").notNull().default(sql`'[]'::jsonb`),
    submittedFrom: text("submitted_from").notNull().default("chat"),
    state: responseStateEnum("state").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
  },
  (table) => ({
    userIdx: index("responses_user_idx").on(table.userId),
    stateIdx: index("responses_state_idx").on(table.state)
  })
);

export const reviewDrafts = pgTable("review_drafts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }).unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").unique(),
  summaryJson: jsonb("summary_json").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true })
});

export const reviewDraftItems = pgTable(
  "review_draft_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    reviewDraftId: uuid("review_draft_id").notNull().references(() => reviewDrafts.id, { onDelete: "cascade" }),
    responseId: uuid("response_id").notNull().references(() => responses.id, { onDelete: "cascade" }).unique(),
    outcome: quizItemOutcomeEnum("outcome").notNull(),
    overallFeedback: text("overall_feedback").notNull().default(""),
    reviewRating: reviewRatingEnum("review_rating"),
    evidenceScore: real("evidence_score").notNull().default(0),
    strengthsJson: jsonb("strengths_json").notNull().default(sql`'[]'::jsonb`),
    weaknessesJson: jsonb("weaknesses_json").notNull().default(sql`'[]'::jsonb`),
    misconceptionsJson: jsonb("misconceptions_json").notNull().default(sql`'[]'::jsonb`),
    learnerNote: text("learner_note"),
    disputeReason: text("dispute_reason"),
    excluded: boolean("excluded").notNull().default(false),
    needsAiReReview: boolean("needs_ai_re_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    draftIdx: index("review_draft_items_draft_idx").on(table.reviewDraftId)
  })
);

export const reviewDraftTopicEvidence = pgTable("review_draft_topic_evidence", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  reviewDraftItemId: uuid("review_draft_item_id").notNull().references(() => reviewDraftItems.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  evidenceStrength: real("evidence_strength").notNull(),
  coverageSignal: real("coverage_signal").notNull()
});

export const gradeResults = pgTable("grade_results", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  responseId: uuid("response_id").notNull().references(() => responses.id, { onDelete: "restrict" }).unique(),
  reviewDraftItemId: uuid("review_draft_item_id").notNull().references(() => reviewDraftItems.id, { onDelete: "restrict" }).unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  overallFeedback: text("overall_feedback").notNull().default(""),
  reviewRating: reviewRatingEnum("review_rating"),
  evidenceScore: real("evidence_score").notNull().default(0),
  strengthsJson: jsonb("strengths_json").notNull().default(sql`'[]'::jsonb`),
  weaknessesJson: jsonb("weaknesses_json").notNull().default(sql`'[]'::jsonb`),
  misconceptionsJson: jsonb("misconceptions_json").notNull().default(sql`'[]'::jsonb`),
  excluded: boolean("excluded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const gradeTopicEvidence = pgTable("grade_topic_evidence", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gradeResultId: uuid("grade_result_id").notNull().references(() => gradeResults.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  evidenceStrength: real("evidence_strength").notNull(),
  coverageSignal: real("coverage_signal").notNull()
});

export const topicProfiles = pgTable(
  "topic_profiles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    overview: text("overview").notNull().default(""),
    knowledgeScore: real("knowledge_score").notNull().default(0),
    coverageScore: real("coverage_score").notNull().default(0),
    strengthsJson: jsonb("strengths_json").notNull().default(sql`'[]'::jsonb`),
    weaknessesJson: jsonb("weaknesses_json").notNull().default(sql`'[]'::jsonb`),
    activeMisconceptionsJson: jsonb("active_misconceptions_json").notNull().default(sql`'[]'::jsonb`),
    recentQuizzesJson: jsonb("recent_quizzes_json").notNull().default(sql`'[]'::jsonb`),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    evidenceCount: integer("evidence_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.topicId] })
  })
);

export const userQuestionState = pgTable(
  "user_question_state",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    lastRating: reviewRatingEnum("last_rating"),
    reviewCount: integer("review_count").notNull().default(0),
    cooldownStateJson: jsonb("cooldown_state_json").notNull().default(sql`'{}'::jsonb`)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.questionId] }),
    dueIdx: index("user_question_state_due_idx").on(table.dueAt)
  })
);

export const userTopicReviewState = pgTable(
  "user_topic_review_state",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    lastRating: reviewRatingEnum("last_rating"),
    reviewCount: integer("review_count").notNull().default(0)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.topicId] }),
    dueIdx: index("user_topic_review_state_due_idx").on(table.dueAt)
  })
);

export const learnerModelUpdates = pgTable("learner_model_updates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
  gradeResultId: uuid("grade_result_id").references(() => gradeResults.id, { onDelete: "set null" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("applied"),
  beforeKnowledge: real("before_knowledge").notNull().default(0),
  afterKnowledge: real("after_knowledge").notNull().default(0),
  beforeCoverage: real("before_coverage").notNull().default(0),
  afterCoverage: real("after_coverage").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow()
});

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  payloadJson: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const quizFeedback = pgTable("quiz_feedback", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
  quizItemId: uuid("quiz_item_id").references(() => quizItems.id, { onDelete: "set null" }),
  feedbackType: text("feedback_type").notNull(),
  feedbackText: text("feedback_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const topicProposals = pgTable("topic_proposals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  proposalType: text("proposal_type").notNull(),
  topicJson: jsonb("topic_json"),
  edgeJson: jsonb("edge_json"),
  tagsJson: jsonb("tags_json"),
  reason: text("reason").notNull().default(""),
  supportingSignalsJson: jsonb("supporting_signals_json").notNull().default(sql`'[]'::jsonb`),
  status: proposalStatusEnum("status").notNull().default("pending"),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true })
});

export const references = pgTable("reference_sources", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").unique(),
  title: text("title").notNull(),
  pathOrUrl: text("path_or_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const referenceChunks = pgTable("reference_chunks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
  heading: text("heading"),
  chunkText: text("chunk_text").notNull(),
  snippet: text("snippet").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const topicEmbeddings = pgTable(
  "topic_embeddings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    textHash: text("text_hash").notNull(),
    embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
    embedding: vector("embedding", { dimensions: 1536 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueEmbedding: unique("topic_embeddings_unique").on(table.topicId, table.embeddingModel),
    vectorIdx: index("topic_embeddings_vector_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  })
);

export const questionEmbeddings = pgTable(
  "question_embeddings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    textHash: text("text_hash").notNull(),
    embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
    embedding: vector("embedding", { dimensions: 1536 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueEmbedding: unique("question_embeddings_unique").on(table.questionId, table.embeddingModel),
    vectorIdx: index("question_embeddings_vector_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  })
);

export const referenceEmbeddings = pgTable(
  "reference_embeddings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    referenceChunkId: uuid("reference_chunk_id").notNull().references(() => referenceChunks.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    textHash: text("text_hash").notNull(),
    embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
    embedding: vector("embedding", { dimensions: 1536 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueEmbedding: unique("reference_embeddings_unique").on(table.referenceChunkId, table.embeddingModel),
    vectorIdx: index("reference_embeddings_vector_idx").using("hnsw", table.embedding.op("vector_cosine_ops"))
  })
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    bodyHash: text("body_hash").notNull(),
    responseJson: jsonb("response_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uniqueKey: unique("idempotency_keys_scope_key_unique").on(table.scope, table.key)
  })
);

export type User = typeof users.$inferSelect;
