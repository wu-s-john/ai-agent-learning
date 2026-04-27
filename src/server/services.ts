import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, type Db } from "@/src/db/client";
import {
  activityEvents,
  gradeResults,
  gradeTopicEvidence,
  idempotencyKeys,
  learnerModelUpdates,
  questionEmbeddings,
  questions,
  questionTags,
  questionTopics,
  quizFeedback,
  quizItems,
  quizzes,
  referenceChunks,
  referenceEmbeddings,
  references,
  responses,
  reviewDraftItems,
  reviewDrafts,
  reviewDraftTopicEvidence,
  topicAliases,
  topicEdges,
  topicEmbeddings,
  topicProfiles,
  topicProposals,
  topics,
  topicTags,
  userQuestionState,
  users,
  userTopicReviewState
} from "@/src/db/schema";
import { assertFound, badRequest, conflict, notFound } from "./errors";
import { addDays, asArray, clamp, embeddingLiteral, jsonHash, slugify, textHash, uniqueStrings } from "./utils";

const defaultUserEmail = process.env.DEFAULT_USER_EMAIL ?? "local@ai-agent-learning.test";
const defaultUserDisplayName = process.env.DEFAULT_USER_DISPLAY_NAME ?? "Local Learner";
const embeddingModel = process.env.EMBEDDING_MODEL ?? "fake-embedding-1536";
const embeddingDimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbLike = Db | Tx;

type TopicInput = {
  topic_id?: string;
  slug?: string;
  title: string;
  overview?: string;
  tags?: string[];
  aliases?: string[];
};

type QuestionInput = {
  question_id?: string;
  slug?: string | null;
  topic_ids?: string[];
  question_tags?: string[];
  modality: "mcq" | "free_response" | "explain_back";
  status?: "active" | "retired";
  prompt: string;
  answer_key?: unknown;
  answer_key_json?: unknown;
  difficulty?: number;
  quality_score?: number;
  created_by?: string;
  provenance?: Record<string, unknown>;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeTag(tag: string) {
  return slugify(tag).replaceAll("_", "-");
}

async function insertActivity(client: DbLike, input: {
  userId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  payload?: unknown;
}) {
  await client.insert(activityEvents).values({
    userId: input.userId ?? null,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    payloadJson: input.payload ?? {}
  });
}

export async function getLocalUser(client: DbLike = db) {
  const existing = await client.query.users.findFirst({ where: eq(users.email, defaultUserEmail) });
  if (existing) return existing;
  const [created] = await client
    .insert(users)
    .values({ email: defaultUserEmail, displayName: defaultUserDisplayName })
    .returning();
  return created;
}

async function withIdempotency<T>(
  client: DbLike,
  userId: string,
  scope: string,
  key: string,
  body: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const bodyHash = jsonHash(body);
  const existing = await client.query.idempotencyKeys.findFirst({
    where: and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))
  });
  if (existing) {
    if (existing.bodyHash !== bodyHash) conflict("Idempotency key reused with a different request body");
    return existing.responseJson as T;
  }
  const response = await fn();
  await client.insert(idempotencyKeys).values({
    userId,
    scope,
    key,
    bodyHash,
    responseJson: response as unknown
  });
  return response;
}

export async function resolveTopicId(idOrSlug: string, client: DbLike = db) {
  const row = await client.query.topics.findFirst({
    where: isUuid(idOrSlug) ? eq(topics.id, idOrSlug) : eq(topics.slug, idOrSlug)
  });
  return assertFound(row, `Topic not found: ${idOrSlug}`).id;
}

export async function resolveQuestionId(idOrSlug: string, client: DbLike = db) {
  const row = await client.query.questions.findFirst({
    where: isUuid(idOrSlug) ? eq(questions.id, idOrSlug) : eq(questions.slug, idOrSlug)
  });
  return assertFound(row, `Question not found: ${idOrSlug}`).id;
}

async function getTopicTags(topicId: string, client: DbLike = db) {
  return (await client.select({ tag: topicTags.tag }).from(topicTags).where(eq(topicTags.topicId, topicId))).map((row) => row.tag);
}

async function getQuestionTags(questionId: string, client: DbLike = db) {
  return (await client.select({ tag: questionTags.tag }).from(questionTags).where(eq(questionTags.questionId, questionId))).map((row) => row.tag);
}

async function getQuestionTopicIds(questionId: string, client: DbLike = db) {
  return (await client.select({ topicId: questionTopics.topicId }).from(questionTopics).where(eq(questionTopics.questionId, questionId))).map((row) => row.topicId);
}

async function embedText(text: string) {
  if ((process.env.EMBEDDING_PROVIDER ?? "fake") !== "fake") {
    throw new Error("Only the fake embedding provider is configured in this MVP scaffold");
  }
  const seed = Buffer.from(textHash(text), "hex");
  return Array.from({ length: embeddingDimensions }, (_, index) => {
    const byte = seed[index % seed.length] ?? 0;
    return (byte / 255) * 2 - 1;
  });
}

async function upsertEmbedding(
  client: DbLike,
  table: "topic" | "question" | "reference",
  entityId: string,
  canonicalText: string
) {
  const hash = textHash(`${embeddingModel}:${canonicalText}`);
  try {
    const embedding = await embedText(canonicalText);
    const values = {
      embeddingModel,
      textHash: hash,
      embeddingStatus: "ready" as const,
      embedding,
      lastError: null,
      updatedAt: new Date()
    };
    if (table === "topic") {
      await client.insert(topicEmbeddings).values({ topicId: entityId, ...values }).onConflictDoUpdate({
        target: [topicEmbeddings.topicId, topicEmbeddings.embeddingModel],
        set: values
      });
    } else if (table === "question") {
      await client.insert(questionEmbeddings).values({ questionId: entityId, ...values }).onConflictDoUpdate({
        target: [questionEmbeddings.questionId, questionEmbeddings.embeddingModel],
        set: values
      });
    } else {
      await client.insert(referenceEmbeddings).values({ referenceChunkId: entityId, ...values }).onConflictDoUpdate({
        target: [referenceEmbeddings.referenceChunkId, referenceEmbeddings.embeddingModel],
        set: values
      });
    }
  } catch (error) {
    const values = {
      embeddingModel,
      textHash: hash,
      embeddingStatus: "pending" as const,
      embedding: null,
      lastError: error instanceof Error ? error.message : "Embedding failed",
      updatedAt: new Date()
    };
    if (table === "topic") {
      await client.insert(topicEmbeddings).values({ topicId: entityId, ...values }).onConflictDoUpdate({
        target: [topicEmbeddings.topicId, topicEmbeddings.embeddingModel],
        set: values
      });
    } else if (table === "question") {
      await client.insert(questionEmbeddings).values({ questionId: entityId, ...values }).onConflictDoUpdate({
        target: [questionEmbeddings.questionId, questionEmbeddings.embeddingModel],
        set: values
      });
    } else {
      await client.insert(referenceEmbeddings).values({ referenceChunkId: entityId, ...values }).onConflictDoUpdate({
        target: [referenceEmbeddings.referenceChunkId, referenceEmbeddings.embeddingModel],
        set: values
      });
    }
  }
}

async function canonicalTopicText(topicId: string, client: DbLike = db) {
  const topic = assertFound(await client.query.topics.findFirst({ where: eq(topics.id, topicId) }));
  const tags = await getTopicTags(topicId, client);
  const aliases = (await client.select({ alias: topicAliases.alias }).from(topicAliases).where(eq(topicAliases.topicId, topicId))).map((row) => row.alias);
  return [`Title: ${topic.title}`, `Slug: ${topic.slug}`, `Aliases: ${aliases.join(", ")}`, `Tags: ${tags.join(", ")}`, `Overview: ${topic.overview}`].join("\n");
}

async function canonicalQuestionText(questionId: string, client: DbLike = db) {
  const question = assertFound(await client.query.questions.findFirst({ where: eq(questions.id, questionId) }));
  const tags = await getQuestionTags(questionId, client);
  const topicRows = await client
    .select({ title: topics.title })
    .from(questionTopics)
    .innerJoin(topics, eq(questionTopics.topicId, topics.id))
    .where(eq(questionTopics.questionId, questionId));
  return [
    `Prompt: ${question.prompt}`,
    `Modality: ${question.modality}`,
    `Topics: ${topicRows.map((row) => row.title).join(", ")}`,
    `Tags: ${tags.join(", ")}`,
    `Answer key: ${question.answerKeyJson ? JSON.stringify(question.answerKeyJson) : ""}`
  ].join("\n");
}

async function canonicalReferenceChunkText(chunkId: string, client: DbLike = db) {
  const [row] = await client
    .select({
      title: references.title,
      pathOrUrl: references.pathOrUrl,
      heading: referenceChunks.heading,
      snippet: referenceChunks.snippet,
      chunkText: referenceChunks.chunkText
    })
    .from(referenceChunks)
    .innerJoin(references, eq(referenceChunks.referenceId, references.id))
    .where(eq(referenceChunks.id, chunkId))
    .limit(1);
  const chunk = assertFound(row, "Reference chunk not found");
  return [`Title: ${chunk.title}`, `Path: ${chunk.pathOrUrl}`, `Heading: ${chunk.heading ?? ""}`, `Snippet: ${chunk.snippet}`, chunk.chunkText].join("\n");
}

export async function createTopic(input: TopicInput) {
  const user = await getLocalUser();
  const slug = input.slug ?? input.topic_id ?? slugify(input.title);
  return await db.transaction(async (tx) => {
    const [topic] = await tx
      .insert(topics)
      .values({ slug, title: input.title, overview: input.overview ?? "" })
      .onConflictDoUpdate({
        target: topics.slug,
        set: { title: input.title, overview: input.overview ?? "", updatedAt: new Date() }
      })
      .returning();
    for (const tag of uniqueStrings(input.tags).map(normalizeTag)) {
      await tx.insert(topicTags).values({ topicId: topic.id, tag }).onConflictDoNothing();
    }
    for (const alias of uniqueStrings(input.aliases)) {
      await tx.insert(topicAliases).values({ topicId: topic.id, alias }).onConflictDoNothing();
    }
    await insertActivity(tx, { userId: user.id, eventType: "topic_saved", entityType: "topic", entityId: topic.id, payload: { slug } });
    await upsertEmbedding(tx, "topic", topic.id, await canonicalTopicText(topic.id, tx));
    return serializeTopic(topic.id, tx);
  });
}

export async function serializeTopic(topicId: string, client: DbLike = db) {
  const topic = assertFound(await client.query.topics.findFirst({ where: eq(topics.id, topicId) }), "Topic not found");
  return {
    topic_id: topic.slug,
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    overview: topic.overview,
    tags: await getTopicTags(topic.id, client),
    created_at: topic.createdAt,
    updated_at: topic.updatedAt
  };
}

export async function searchTopics(query: string | null, limit = 10) {
  const q = query?.trim();
  const rows = q
    ? await db
        .select()
        .from(topics)
        .where(or(ilike(topics.title, `%${q}%`), ilike(topics.slug, `%${slugify(q)}%`), ilike(topics.overview, `%${q}%`)))
        .limit(limit)
    : await db.select().from(topics).orderBy(asc(topics.title)).limit(limit);
  const matches = await Promise.all(
    rows.map(async (topic) => ({
      topic_id: topic.slug,
      id: topic.id,
      title: topic.title,
      tags: await getTopicTags(topic.id),
      match_type: q && topic.slug === slugify(q) ? "exact" : "keyword",
      score: q && topic.slug === slugify(q) ? 1 : 0.75
    }))
  );
  return { matches, resolved: matches.length === 1 && matches[0]?.score >= 0.9 };
}

export async function getTopic(idOrSlug: string) {
  return serializeTopic(await resolveTopicId(idOrSlug));
}

export async function patchTopic(idOrSlug: string, input: { slug?: string; title?: string; overview?: string; aliases?: string[] }) {
  const topicId = await resolveTopicId(idOrSlug);
  const [topic] = await db
    .update(topics)
    .set({
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.overview != null ? { overview: input.overview } : {}),
      updatedAt: new Date()
    })
    .where(eq(topics.id, topicId))
    .returning();
  if (input.aliases) {
    await db.delete(topicAliases).where(eq(topicAliases.topicId, topicId));
    for (const alias of uniqueStrings(input.aliases)) await db.insert(topicAliases).values({ topicId, alias }).onConflictDoNothing();
  }
  await upsertEmbedding(db, "topic", topicId, await canonicalTopicText(topicId));
  return serializeTopic(topic.id);
}

export async function addTopicTags(idOrSlug: string, tags: string[]) {
  const topicId = await resolveTopicId(idOrSlug);
  for (const tag of uniqueStrings(tags).map(normalizeTag)) {
    await db.insert(topicTags).values({ topicId, tag }).onConflictDoNothing();
  }
  await upsertEmbedding(db, "topic", topicId, await canonicalTopicText(topicId));
  return serializeTopic(topicId);
}

export async function deleteTopicTag(idOrSlug: string, tag: string) {
  const topicId = await resolveTopicId(idOrSlug);
  await db.delete(topicTags).where(and(eq(topicTags.topicId, topicId), eq(topicTags.tag, normalizeTag(tag))));
  await upsertEmbedding(db, "topic", topicId, await canonicalTopicText(topicId));
  return { deleted: true };
}

export async function createTopicEdge(input: { from_topic_id: string; to_topic_id: string; edge_type: "prereq_of" | "part_of" | "related_to" }) {
  const fromTopicId = await resolveTopicId(input.from_topic_id);
  const toTopicId = await resolveTopicId(input.to_topic_id);
  const [edge] = await db
    .insert(topicEdges)
    .values({ fromTopicId, toTopicId, edgeType: input.edge_type })
    .onConflictDoNothing()
    .returning();
  return edge ?? (await db.query.topicEdges.findFirst({ where: and(eq(topicEdges.fromTopicId, fromTopicId), eq(topicEdges.toTopicId, toTopicId), eq(topicEdges.edgeType, input.edge_type)) }));
}

export async function getTopicEdges(idOrSlug: string, filters: { edgeTypes?: string[]; direction?: string } = {}) {
  const topicId = await resolveTopicId(idOrSlug);
  const direction = filters.direction ?? "both";
  const clauses = [];
  if (direction === "out" || direction === "both") clauses.push(eq(topicEdges.fromTopicId, topicId));
  if (direction === "in" || direction === "both") clauses.push(eq(topicEdges.toTopicId, topicId));
  const where = clauses.length === 1 ? clauses[0] : or(...clauses);
  const edges = await db.select().from(topicEdges).where(where);
  return {
    edges: edges
      .filter((edge) => !filters.edgeTypes?.length || filters.edgeTypes.includes(edge.edgeType))
      .map((edge) => ({
        edge_id: edge.id,
        from_topic_id: edge.fromTopicId,
        to_topic_id: edge.toTopicId,
        edge_type: edge.edgeType
      }))
  };
}

export async function deleteTopicEdge(edgeId: string) {
  await db.delete(topicEdges).where(eq(topicEdges.id, edgeId));
  return { deleted: true };
}

export async function createQuestion(input: QuestionInput) {
  return await db.transaction(async (tx) => {
    const slug = input.slug ?? input.question_id ?? null;
    const values = {
      slug,
      prompt: input.prompt,
      modality: input.modality,
      status: input.status ?? "active",
      answerKeyJson: input.answer_key_json ?? input.answer_key ?? null,
      difficulty: input.difficulty ?? 0.5,
      qualityScore: input.quality_score ?? 0.5,
      createdBy: input.created_by ?? "ai",
      provenanceJson: input.provenance ?? {},
      updatedAt: new Date()
    };
    const [question] = slug
      ? await tx
          .insert(questions)
          .values(values)
          .onConflictDoUpdate({
            target: questions.slug,
            set: {
              prompt: values.prompt,
              modality: values.modality,
              status: values.status,
              answerKeyJson: values.answerKeyJson,
              difficulty: values.difficulty,
              qualityScore: values.qualityScore,
              provenanceJson: values.provenanceJson,
              updatedAt: new Date()
            }
          })
          .returning()
      : await tx.insert(questions).values(values).returning();
    await tx.delete(questionTopics).where(eq(questionTopics.questionId, question.id));
    await tx.delete(questionTags).where(eq(questionTags.questionId, question.id));
    for (const topicRef of input.topic_ids ?? []) {
      await tx.insert(questionTopics).values({ questionId: question.id, topicId: await resolveTopicId(topicRef, tx) }).onConflictDoNothing();
    }
    for (const tag of uniqueStrings(input.question_tags).map(normalizeTag)) {
      await tx.insert(questionTags).values({ questionId: question.id, tag }).onConflictDoNothing();
    }
    await upsertEmbedding(tx, "question", question.id, await canonicalQuestionText(question.id, tx));
    return serializeQuestion(question.id, tx);
  });
}

export async function serializeQuestion(questionId: string, client: DbLike = db) {
  const question = assertFound(await client.query.questions.findFirst({ where: eq(questions.id, questionId) }), "Question not found");
  return {
    question_id: question.slug ?? question.id,
    id: question.id,
    slug: question.slug,
    topic_ids: await getQuestionTopicIds(question.id, client),
    question_tags: await getQuestionTags(question.id, client),
    modality: question.modality,
    status: question.status,
    prompt: question.prompt,
    answer_key: question.answerKeyJson ?? null,
    difficulty: question.difficulty,
    quality_score: question.qualityScore,
    created_at: question.createdAt,
    updated_at: question.updatedAt
  };
}

export async function searchQuestions(query: string | null, filters: {
  topicId?: string | null;
  limit?: number;
  status?: string | null;
  modality?: string | null;
  tag?: string | null;
  difficultyTarget?: number | null;
  includeDue?: boolean;
} = {}) {
  const user = await getLocalUser();
  const limit = filters.limit ?? 20;
  const topicId = filters.topicId ? await resolveTopicId(filters.topicId) : null;
  const includeDue = filters.includeDue ?? true;
  const clauses = [];
  const status = filters.status ?? "active";
  if (status) clauses.push(eq(questions.status, status as "active" | "retired"));
  if (filters.modality) clauses.push(eq(questions.modality, filters.modality as "mcq" | "free_response" | "explain_back"));
  const candidateLimit = Math.max(limit * 5, 100);
  const rows = await db.selectDistinct({ id: questions.id }).from(questions)
    .leftJoin(questionTopics, eq(questionTopics.questionId, questions.id))
    .leftJoin(questionTags, eq(questionTags.questionId, questions.id))
    .where(and(...[
      ...clauses,
      ...(topicId ? [eq(questionTopics.topicId, topicId)] : []),
      ...(filters.tag ? [eq(questionTags.tag, normalizeTag(filters.tag))] : [])
    ]))
    .limit(candidateLimit);
  const questionsOut = await Promise.all(rows.map((row) => serializeQuestion(row.id)));
  const states = rows.length
    ? await db.select().from(userQuestionState).where(and(eq(userQuestionState.userId, user.id), inArray(userQuestionState.questionId, rows.map((row) => row.id))))
    : [];
  const stateByQuestion = new Map(states.map((state) => [state.questionId, state]));
  const normalizedQueryTokens = uniqueStrings(slugify(query ?? "").split("_").filter(Boolean));
  const normalizedTag = filters.tag ? normalizeTag(filters.tag) : null;
  const now = Date.now();
  const ranked = questionsOut.map((question) => {
    const state = stateByQuestion.get(question.id);
    const due = Boolean(state?.dueAt && state.dueAt.getTime() <= now);
    const promptTokens = new Set(slugify(question.prompt).split("_").filter(Boolean));
    const textMatchStrength = normalizedQueryTokens.length
      ? normalizedQueryTokens.filter((token) => promptTokens.has(token)).length / normalizedQueryTokens.length
      : 0;
    const tagOverlap = normalizedTag ? question.question_tags.filter((tag) => tag === normalizedTag).length : 0;
    const difficultyDistance = filters.difficultyTarget == null ? null : Math.abs(question.difficulty - filters.difficultyTarget);
    const dueBonusApplied = includeDue && due;
    const topicMatch = topicId ? question.topic_ids.includes(topicId) : false;
    const retrievalScore = clamp(
      (topicId ? (topicMatch ? 0.35 : 0) : 0.15) +
        (normalizedQueryTokens.length ? textMatchStrength * 0.25 : 0.05) +
        (normalizedTag ? Math.min(tagOverlap, 1) * 0.15 : 0.05) +
        question.quality_score * 0.15 +
        (difficultyDistance == null ? 0.05 : Math.max(0, 1 - difficultyDistance) * 0.1) +
        (dueBonusApplied ? 0.1 : 0),
      0,
      1
    );
    const matchType = normalizedQueryTokens.length && textMatchStrength > 0 ? "keyword" : topicId || normalizedTag ? "filter" : "browse";
    return {
      ...question,
      due,
      due_at: state?.dueAt ?? null,
      last_rating: state?.lastRating ?? null,
      match_type: matchType,
      score: retrievalScore,
      retrieval_score: retrievalScore,
      retrieval_signals: {
        topic_match: topicId ? topicMatch : null,
        tag_overlap: tagOverlap,
        difficulty_distance: difficultyDistance,
        quality_score: question.quality_score,
        due_bonus_applied: dueBonusApplied
      }
    };
  }).sort((a, b) => b.retrieval_score - a.retrieval_score).slice(0, limit);
  return {
    questions: ranked
  };
}

export async function getQuestion(idOrSlug: string) {
  return serializeQuestion(await resolveQuestionId(idOrSlug));
}

export async function patchQuestion(idOrSlug: string, input: Partial<QuestionInput>) {
  const questionId = await resolveQuestionId(idOrSlug);
  await db.transaction(async (tx) => {
    await tx
      .update(questions)
      .set({
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.modality ? { modality: input.modality } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.answer_key !== undefined || input.answer_key_json !== undefined ? { answerKeyJson: input.answer_key_json ?? input.answer_key ?? null } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.quality_score !== undefined ? { qualityScore: input.quality_score } : {}),
        updatedAt: new Date()
      })
      .where(eq(questions.id, questionId));
    if (input.topic_ids) {
      await tx.delete(questionTopics).where(eq(questionTopics.questionId, questionId));
      for (const topicRef of input.topic_ids) {
        await tx.insert(questionTopics).values({ questionId, topicId: await resolveTopicId(topicRef, tx) }).onConflictDoNothing();
      }
    }
    if (input.question_tags) {
      await tx.delete(questionTags).where(eq(questionTags.questionId, questionId));
      for (const tag of uniqueStrings(input.question_tags).map(normalizeTag)) await tx.insert(questionTags).values({ questionId, tag }).onConflictDoNothing();
    }
    await upsertEmbedding(tx, "question", questionId, await canonicalQuestionText(questionId, tx));
  });
  return serializeQuestion(questionId);
}

export async function addQuestionTags(idOrSlug: string, tags: string[]) {
  const questionId = await resolveQuestionId(idOrSlug);
  for (const tag of uniqueStrings(tags).map(normalizeTag)) await db.insert(questionTags).values({ questionId, tag }).onConflictDoNothing();
  await upsertEmbedding(db, "question", questionId, await canonicalQuestionText(questionId));
  return serializeQuestion(questionId);
}

export async function deleteQuestionTag(idOrSlug: string, tag: string) {
  const questionId = await resolveQuestionId(idOrSlug);
  await db.delete(questionTags).where(and(eq(questionTags.questionId, questionId), eq(questionTags.tag, normalizeTag(tag))));
  await upsertEmbedding(db, "question", questionId, await canonicalQuestionText(questionId));
  return { deleted: true };
}

export async function createQuiz(input: {
  slug?: string;
  quiz_type?: string;
  topic_ids?: string[];
  mode?: string;
  purpose?: string | null;
  grading_posture?: string | null;
  difficulty_target?: number | null;
  hint_policy?: string | null;
  answer_reveal_policy?: "after_each_item" | "after_quiz" | "never_in_chat";
  time_pressure?: unknown;
  question_refs: { question_id: string; order: number }[];
}) {
  const user = await getLocalUser();
  return await db.transaction(async (tx) => {
    const topicIds = [];
    for (const ref of input.topic_ids ?? []) topicIds.push(await resolveTopicId(ref, tx));
    const [quiz] = await tx
      .insert(quizzes)
      .values({
        slug: input.slug,
        userId: user.id,
        quizType: input.quiz_type ?? "standard",
        mode: input.mode ?? "mixed",
        purpose: input.purpose ?? null,
        gradingPosture: input.grading_posture ?? null,
        difficultyTarget: input.difficulty_target ?? null,
        hintPolicy: input.hint_policy ?? null,
        answerRevealPolicy: input.answer_reveal_policy ?? "after_quiz",
        timePressureJson: input.time_pressure ?? null,
        topicIdsSnapshot: topicIds
      })
      .returning();
    const createdItems = [];
    for (const ref of input.question_refs.sort((a, b) => a.order - b.order)) {
      const questionId = await resolveQuestionId(ref.question_id, tx);
      const question = assertFound(await tx.query.questions.findFirst({ where: eq(questions.id, questionId) }));
      const [item] = await tx
        .insert(quizItems)
        .values({
          quizId: quiz.id,
          questionId,
          orderIndex: ref.order,
          promptSnapshot: question.prompt,
          modalitySnapshot: question.modality,
          answerKeySnapshotJson: question.answerKeyJson,
          topicIdsSnapshot: await getQuestionTopicIds(questionId, tx),
          questionTagsSnapshot: await getQuestionTags(questionId, tx)
        })
        .returning();
      createdItems.push(item);
    }
    await insertActivity(tx, { userId: user.id, eventType: "quiz_created", entityType: "quiz", entityId: quiz.id, payload: { item_count: createdItems.length } });
    return serializeQuiz(quiz.id, tx, true);
  });
}

export async function serializeQuiz(quizId: string, client: DbLike = db, includeItems = false) {
  const quiz = assertFound(await client.query.quizzes.findFirst({ where: eq(quizzes.id, quizId) }), "Quiz not found");
  const itemPayload = includeItems ? await getQuizItems(quiz.id, client) : null;
  return {
    quiz_id: quiz.id,
    slug: quiz.slug,
    quiz_type: quiz.quizType,
    topic_ids: quiz.topicIdsSnapshot,
    mode: quiz.mode,
    purpose: quiz.purpose,
    grading_posture: quiz.gradingPosture,
    difficulty_target: quiz.difficultyTarget,
    hint_policy: quiz.hintPolicy,
    answer_reveal_policy: quiz.answerRevealPolicy,
    time_pressure: quiz.timePressureJson,
    status: quiz.status,
    item_count: itemPayload?.items.length ?? 0,
    created_at: quiz.createdAt,
    ...(itemPayload ? { items: itemPayload.items } : {})
  };
}

export async function getQuiz(quizId: string) {
  return serializeQuiz(quizId, db, false);
}

export async function listQuizzes(filters: { topicId?: string | null; limit?: number }) {
  const limit = filters.limit ?? 20;
  const rows = await db.select().from(quizzes).orderBy(desc(quizzes.createdAt)).limit(limit);
  const topicId = filters.topicId ? await resolveTopicId(filters.topicId) : null;
  const filtered = topicId ? rows.filter((quiz) => asArray<string>(quiz.topicIdsSnapshot).includes(topicId)) : rows;
  return { quizzes: filtered.map((quiz) => ({ quiz_id: quiz.id, status: quiz.status, purpose: quiz.purpose, created_at: quiz.createdAt })) };
}

export async function getQuizItems(quizId: string, client: DbLike = db) {
  const rows = await client.select().from(quizItems).where(eq(quizItems.quizId, quizId)).orderBy(asc(quizItems.orderIndex));
  const responseRows = await client.select().from(responses).where(inArray(responses.quizItemId, rows.map((row) => row.id).length ? rows.map((row) => row.id) : ["00000000-0000-0000-0000-000000000000"]));
  const byItem = new Map(responseRows.map((response) => [response.quizItemId, response]));
  return {
    quiz_id: quizId,
    items: rows.map((item) => {
      const response = byItem.get(item.id);
      return {
        quiz_item_id: item.id,
        question_id: item.questionId,
        order: item.orderIndex,
        modality: item.modalitySnapshot,
        prompt: item.promptSnapshot,
        topic_ids: item.topicIdsSnapshot,
        question_tags: item.questionTagsSnapshot,
        answer_key: item.answerKeySnapshotJson ?? null,
        outcome: item.outcome,
        response_id: response?.id ?? null,
        response_state: response?.state ?? null
      };
    })
  };
}

export async function getQuizItem(quizItemId: string) {
  const item = assertFound(await db.query.quizItems.findFirst({ where: eq(quizItems.id, quizItemId) }), "Quiz item not found");
  const response = await db.query.responses.findFirst({ where: eq(responses.quizItemId, quizItemId) });
  return {
    quiz_item_id: item.id,
    quiz_id: item.quizId,
    question_id: item.questionId,
    order: item.orderIndex,
    prompt: item.promptSnapshot,
    modality: item.modalitySnapshot,
    topic_ids: item.topicIdsSnapshot,
    question_tags: item.questionTagsSnapshot,
    answer_key: item.answerKeySnapshotJson ?? null,
    outcome: item.outcome,
    response_id: response?.id ?? null,
    response_state: response?.state ?? null
  };
}

export async function saveResponseDraft(quizItemId: string, input: {
  outcome: "answered" | "skipped" | "no_answer" | "timed_out" | "abandoned" | "excluded";
  answer_text?: string | null;
  image_refs?: string[];
  submitted_from?: string;
  answer_reveal_policy?: "after_each_item" | "after_quiz" | "never_in_chat";
}) {
  const user = await getLocalUser();
  return await db.transaction(async (tx) => {
    const item = assertFound(await tx.query.quizItems.findFirst({ where: eq(quizItems.id, quizItemId) }), "Quiz item not found");
    const quiz = assertFound(await tx.query.quizzes.findFirst({ where: eq(quizzes.id, item.quizId) }), "Quiz not found");
    if (!["created", "in_progress"].includes(quiz.status)) conflict("Cannot edit responses after quiz responses are submitted");
    const existing = await tx.query.responses.findFirst({ where: eq(responses.quizItemId, quizItemId) });
    const responseValues = {
      userId: user.id,
      quizItemId,
      answerText: input.answer_text ?? null,
      imageRefsJson: input.image_refs ?? [],
      submittedFrom: input.submitted_from ?? "chat",
      state: "draft" as const,
      updatedAt: new Date()
    };
    const [response] = existing
      ? await tx.update(responses).set(responseValues).where(eq(responses.id, existing.id)).returning()
      : await tx.insert(responses).values(responseValues).returning();
    await tx.update(quizItems).set({ outcome: input.outcome, updatedAt: new Date() }).where(eq(quizItems.id, quizItemId));
    await tx
      .update(quizzes)
      .set({
        status: "in_progress",
        updatedAt: new Date(),
        ...(input.answer_reveal_policy ? { answerRevealPolicy: input.answer_reveal_policy } : {})
      })
      .where(eq(quizzes.id, item.quizId));
    await insertActivity(tx, { userId: user.id, eventType: "response_draft_saved", entityType: "response", entityId: response.id, payload: { outcome: input.outcome } });
    return {
      response_id: response.id,
      quiz_id: item.quizId,
      quiz_item_id: quizItemId,
      outcome: input.outcome,
      response_state: "draft",
      answer_reveal_policy: input.answer_reveal_policy ?? quiz.answerRevealPolicy,
      quiz_status: "in_progress"
    };
  });
}

export async function submitQuizResponses(quizId: string, input: { idempotency_key: string; submitted_from?: string }) {
  const user = await getLocalUser();
  return await db.transaction(async (tx) =>
    withIdempotency(tx, user.id, `quiz:${quizId}:responses_submit`, input.idempotency_key, input, async () => {
      const quiz = assertFound(await tx.query.quizzes.findFirst({ where: eq(quizzes.id, quizId) }), "Quiz not found");
      if (["review_drafted", "finalized"].includes(quiz.status)) conflict("Quiz responses have already moved past submission");
      const items = await tx.select().from(quizItems).where(eq(quizItems.quizId, quizId)).orderBy(asc(quizItems.orderIndex));
      const responseRows = await tx.select().from(responses).where(inArray(responses.quizItemId, items.map((item) => item.id).length ? items.map((item) => item.id) : ["00000000-0000-0000-0000-000000000000"]));
      if (responseRows.length === 0) conflict("No presented quiz items have response drafts");
      for (const response of responseRows) {
        await tx.update(responses).set({ state: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(responses.id, response.id));
      }
      await tx.update(quizzes).set({ status: "responses_submitted", updatedAt: new Date() }).where(eq(quizzes.id, quizId));
      await insertActivity(tx, { userId: user.id, eventType: "responses_submitted", entityType: "quiz", entityId: quizId, payload: { response_count: responseRows.length } });
      const responseByItem = new Map(responseRows.map((response) => [response.quizItemId, response]));
      const submitted = [];
      const reviewPayload = [];
      for (const item of items) {
        const response = responseByItem.get(item.id);
        if (!response || !item.outcome) continue;
        submitted.push({ quiz_item_id: item.id, response_id: response.id, outcome: item.outcome, response_state: "submitted" });
        reviewPayload.push({
          response_id: response.id,
          quiz_item_id: item.id,
          question: {
            question_id: item.questionId,
            topic_ids: item.topicIdsSnapshot,
            question_tags: item.questionTagsSnapshot,
            modality: item.modalitySnapshot,
            prompt: item.promptSnapshot,
            answer_key: item.answerKeySnapshotJson ?? null
          },
          response: {
            outcome: item.outcome,
            answer_text: response.answerText
          }
        });
      }
      return { quiz_id: quizId, status: "responses_submitted", responses: submitted, review_payload: reviewPayload };
    })
  );
}

export async function getResponse(responseId: string) {
  if (!isUuid(responseId)) notFound(`Response not found: ${responseId}`);
  const response = assertFound(await db.query.responses.findFirst({ where: eq(responses.id, responseId) }), "Response not found");
  const item = assertFound(await db.query.quizItems.findFirst({ where: eq(quizItems.id, response.quizItemId) }), "Quiz item not found");
  return {
    response_id: response.id,
    quiz_id: item.quizId,
    quiz_item_id: item.id,
    question: {
      question_id: item.questionId,
      topic_ids: item.topicIdsSnapshot,
      question_tags: item.questionTagsSnapshot,
      modality: item.modalitySnapshot,
      prompt: item.promptSnapshot,
      answer_key: item.answerKeySnapshotJson ?? null
    },
    response: {
      outcome: item.outcome,
      answer_text: response.answerText,
      image_refs: response.imageRefsJson,
      response_state: response.state
    }
  };
}

export async function createReviewDraft(quizId: string, input: {
  idempotency_key?: string;
  summary?: Record<string, unknown>;
  items: Array<{
    response_id: string;
    outcome: "answered" | "skipped" | "no_answer" | "timed_out" | "abandoned" | "excluded";
    overall_feedback?: string;
    review_rating?: "Again" | "Hard" | "Good" | "Easy" | null;
    evidence_score?: number;
    strengths?: string[];
    weaknesses?: string[];
    misconceptions?: string[];
    topic_evidence?: Array<{ topic_id: string; evidence_strength: number; coverage_signal: number }>;
    excluded?: boolean;
    needs_ai_re_review?: boolean;
  }>;
}) {
  const user = await getLocalUser();
  const work = async (tx: Tx) => {
    const quiz = assertFound(await tx.query.quizzes.findFirst({ where: eq(quizzes.id, quizId) }), "Quiz not found");
    if (quiz.status === "finalized") conflict("Cannot create a review draft for a finalized quiz");
    if (quiz.status !== "responses_submitted" && quiz.status !== "review_drafted") conflict("Quiz responses must be submitted before review draft creation");
    const seenResponseIds = new Set<string>();
    const validatedItems: Array<{
      item: (typeof input.items)[number];
      response: typeof responses.$inferSelect;
      topicEvidence: Array<{ topicId: string; evidenceStrength: number; coverageSignal: number }>;
    }> = [];
    for (const item of input.items) {
      if (seenResponseIds.has(item.response_id)) conflict("Review draft contains duplicate response IDs");
      seenResponseIds.add(item.response_id);
      const response = assertFound(await tx.query.responses.findFirst({ where: eq(responses.id, item.response_id) }), "Response not found");
      if (response.state !== "submitted" && response.state !== "review_drafted") conflict("Only submitted responses can be reviewed");
      const quizItem = assertFound(await tx.query.quizItems.findFirst({ where: eq(quizItems.id, response.quizItemId) }), "Quiz item not found");
      if (quizItem.quizId !== quizId) conflict("Response does not belong to this quiz");
      if (quizItem.outcome !== item.outcome) conflict("Review draft item outcome does not match the stored quiz item outcome");
      const excluded = item.excluded ?? false;
      if (!excluded && !item.review_rating) conflict("Non-excluded review draft items require a review rating");
      if (!excluded && !item.topic_evidence?.length) conflict("Non-excluded review draft items require topic evidence");
      const topicEvidence = [];
      for (const evidence of item.topic_evidence ?? []) {
        topicEvidence.push({
          topicId: await resolveTopicId(evidence.topic_id, tx),
          evidenceStrength: evidence.evidence_strength,
          coverageSignal: evidence.coverage_signal
        });
      }
      validatedItems.push({ item, response, topicEvidence });
    }
    const existing = await tx.query.reviewDrafts.findFirst({ where: eq(reviewDrafts.quizId, quizId) });
    if (existing?.finalizedAt) conflict("Review draft is already finalized");
    if (existing) {
      const oldDraftItems = await tx.select({ responseId: reviewDraftItems.responseId }).from(reviewDraftItems).where(eq(reviewDraftItems.reviewDraftId, existing.id));
      const oldResponseIds = oldDraftItems.map((item) => item.responseId);
      if (oldResponseIds.length) {
        await tx.update(responses).set({ state: "submitted", updatedAt: new Date() }).where(inArray(responses.id, oldResponseIds));
      }
      await tx.delete(reviewDrafts).where(eq(reviewDrafts.id, existing.id));
    }
    const [draft] = await tx.insert(reviewDrafts).values({ quizId, userId: user.id, idempotencyKey: input.idempotency_key, summaryJson: input.summary ?? {} }).returning();
    for (const { item, response, topicEvidence } of validatedItems) {
      const [draftItem] = await tx
        .insert(reviewDraftItems)
        .values({
          reviewDraftId: draft.id,
          responseId: response.id,
          outcome: item.outcome,
          overallFeedback: item.overall_feedback ?? "",
          reviewRating: item.review_rating ?? null,
          evidenceScore: item.evidence_score ?? 0,
          strengthsJson: item.strengths ?? [],
          weaknessesJson: item.weaknesses ?? [],
          misconceptionsJson: item.misconceptions ?? [],
          excluded: item.excluded ?? false,
          needsAiReReview: item.needs_ai_re_review ?? false
        })
        .returning();
      for (const evidence of topicEvidence) {
        await tx.insert(reviewDraftTopicEvidence).values({
          reviewDraftItemId: draftItem.id,
          topicId: evidence.topicId,
          evidenceStrength: evidence.evidenceStrength,
          coverageSignal: evidence.coverageSignal
        });
      }
      await tx.update(responses).set({ state: "review_drafted", updatedAt: new Date() }).where(eq(responses.id, response.id));
    }
    await tx.update(quizzes).set({ status: "review_drafted", updatedAt: new Date() }).where(eq(quizzes.id, quizId));
    await insertActivity(tx, { userId: user.id, eventType: "review_draft_created", entityType: "quiz", entityId: quizId });
    return { quiz_id: quizId, review_draft_id: draft.id, status: "review_drafted", item_count: input.items.length };
  };
  return await db.transaction(async (tx) =>
    input.idempotency_key
      ? withIdempotency(tx, user.id, `quiz:${quizId}:review_draft`, input.idempotency_key, input, () => work(tx))
      : work(tx)
  );
}

export async function getReviewDraft(quizId: string) {
  const draft = assertFound(await db.query.reviewDrafts.findFirst({ where: eq(reviewDrafts.quizId, quizId) }), "Review draft not found");
  const items = await db
    .select({
      id: reviewDraftItems.id,
      responseId: reviewDraftItems.responseId,
      outcome: reviewDraftItems.outcome,
      overallFeedback: reviewDraftItems.overallFeedback,
      reviewRating: reviewDraftItems.reviewRating,
      evidenceScore: reviewDraftItems.evidenceScore,
      strengthsJson: reviewDraftItems.strengthsJson,
      weaknessesJson: reviewDraftItems.weaknessesJson,
      misconceptionsJson: reviewDraftItems.misconceptionsJson,
      learnerNote: reviewDraftItems.learnerNote,
      disputeReason: reviewDraftItems.disputeReason,
      excluded: reviewDraftItems.excluded,
      needsAiReReview: reviewDraftItems.needsAiReReview,
      quizItemId: responses.quizItemId,
      answerText: responses.answerText,
      prompt: quizItems.promptSnapshot
    })
    .from(reviewDraftItems)
    .innerJoin(responses, eq(reviewDraftItems.responseId, responses.id))
    .innerJoin(quizItems, eq(responses.quizItemId, quizItems.id))
    .where(eq(reviewDraftItems.reviewDraftId, draft.id));
  const evidence = await db.select().from(reviewDraftTopicEvidence).where(inArray(reviewDraftTopicEvidence.reviewDraftItemId, items.map((item) => item.id).length ? items.map((item) => item.id) : ["00000000-0000-0000-0000-000000000000"]));
  return {
    quiz_id: quizId,
    review_draft_id: draft.id,
    status: "review_drafted",
    summary: draft.summaryJson,
    items: items.map((item) => ({
      review_draft_item_id: item.id,
      quiz_item_id: item.quizItemId,
      response_id: item.responseId,
      outcome: item.outcome,
      prompt: item.prompt,
      answer_text: item.answerText,
      overall_feedback: item.overallFeedback,
      review_rating: item.reviewRating,
      evidence_score: item.evidenceScore,
      strengths: item.strengthsJson,
      weaknesses: item.weaknessesJson,
      misconceptions: item.misconceptionsJson,
      topic_evidence: evidence
        .filter((row) => row.reviewDraftItemId === item.id)
        .map((row) => ({ topic_id: row.topicId, evidence_strength: row.evidenceStrength, coverage_signal: row.coverageSignal })),
      learner_note: item.learnerNote,
      dispute_reason: item.disputeReason,
      excluded: item.excluded,
      needs_ai_re_review: item.needsAiReReview
    }))
  };
}

export async function patchReviewDraft(quizId: string, input: { summary?: Record<string, unknown>; items?: Array<{ review_draft_item_id: string; overall_feedback?: string; learner_note?: string | null; dispute_reason?: string | null; excluded?: boolean }> }) {
  const draft = assertFound(await db.query.reviewDrafts.findFirst({ where: eq(reviewDrafts.quizId, quizId) }), "Review draft not found");
  if (draft.finalizedAt) conflict("Cannot edit a finalized review draft");
  if (input.summary) await db.update(reviewDrafts).set({ summaryJson: input.summary, updatedAt: new Date() }).where(eq(reviewDrafts.id, draft.id));
  for (const item of input.items ?? []) {
    await db
      .update(reviewDraftItems)
      .set({
        ...(item.overall_feedback !== undefined ? { overallFeedback: item.overall_feedback } : {}),
        ...(item.learner_note !== undefined ? { learnerNote: item.learner_note } : {}),
        ...(item.dispute_reason !== undefined ? { disputeReason: item.dispute_reason, needsAiReReview: Boolean(item.dispute_reason) } : {}),
        ...(item.excluded !== undefined ? { excluded: item.excluded } : {}),
        updatedAt: new Date()
      })
      .where(and(eq(reviewDraftItems.id, item.review_draft_item_id), eq(reviewDraftItems.reviewDraftId, draft.id)));
  }
  return { quiz_id: quizId, review_draft_id: draft.id, status: "review_drafted", saved: true, needs_ai_re_review: (await hasPendingReReview(draft.id)) };
}

async function hasPendingReReview(reviewDraftId: string, client: DbLike = db) {
  const row = await client.query.reviewDraftItems.findFirst({
    where: and(eq(reviewDraftItems.reviewDraftId, reviewDraftId), eq(reviewDraftItems.excluded, false), eq(reviewDraftItems.needsAiReReview, true))
  });
  return Boolean(row);
}

const ratingAnchor = { Again: 0.15, Hard: 0.45, Good: 0.75, Easy: 0.9 } as const;
const dueDays = { Again: 1, Hard: 3, Good: 7, Easy: 14 } as const;

export async function finalizeReviewDraft(quizId: string, input: { idempotency_key: string }) {
  const user = await getLocalUser();
  return await db.transaction(async (tx) =>
    withIdempotency(tx, user.id, `quiz:${quizId}:review_finalize`, input.idempotency_key, input, async () => {
      const quiz = assertFound(await tx.query.quizzes.findFirst({ where: eq(quizzes.id, quizId) }), "Quiz not found");
      if (quiz.status === "finalized") conflict("Quiz is already finalized");
      if (quiz.status !== "review_drafted") conflict("Quiz must have a review draft before finalization");
      const draft = assertFound(await tx.query.reviewDrafts.findFirst({ where: eq(reviewDrafts.quizId, quizId) }), "Review draft not found");
      if (await hasPendingReReview(draft.id, tx)) conflict("Review draft has items that need AI re-review");
      const draftItems = await tx.select().from(reviewDraftItems).where(eq(reviewDraftItems.reviewDraftId, draft.id));
      if (draftItems.length === 0) conflict("Cannot finalize an empty review draft");
      const results = [];
      const updates = [];
      for (const draftItem of draftItems) {
        const response = assertFound(await tx.query.responses.findFirst({ where: eq(responses.id, draftItem.responseId) }), "Response not found");
        const quizItem = assertFound(await tx.query.quizItems.findFirst({ where: eq(quizItems.id, response.quizItemId) }), "Quiz item not found");
        if (quizItem.quizId !== quizId) conflict("Review draft response does not belong to this quiz");
        if (quizItem.outcome !== draftItem.outcome) conflict("Review draft item outcome does not match the stored quiz item outcome");
        const evidenceRows = await tx.select().from(reviewDraftTopicEvidence).where(eq(reviewDraftTopicEvidence.reviewDraftItemId, draftItem.id));
        if (!draftItem.excluded) {
          if (draftItem.needsAiReReview) conflict("Review draft has items that need AI re-review");
          if (!draftItem.reviewRating) conflict("Non-excluded review draft items require a review rating");
          if (evidenceRows.length === 0) conflict("Non-excluded review draft items require topic evidence");
        }
        const [grade] = await tx
          .insert(gradeResults)
          .values({
            responseId: response.id,
            reviewDraftItemId: draftItem.id,
            userId: user.id,
            overallFeedback: draftItem.overallFeedback,
            reviewRating: draftItem.reviewRating,
            evidenceScore: draftItem.evidenceScore,
            strengthsJson: draftItem.strengthsJson,
            weaknessesJson: draftItem.weaknessesJson,
            misconceptionsJson: draftItem.misconceptionsJson,
            excluded: draftItem.excluded
          })
          .returning();
        results.push({ response_id: response.id, grade_id: grade.id, outcome: draftItem.outcome, excluded: draftItem.excluded });
        for (const evidence of evidenceRows) {
          await tx.insert(gradeTopicEvidence).values({
            gradeResultId: grade.id,
            topicId: evidence.topicId,
            evidenceStrength: evidence.evidenceStrength,
            coverageSignal: evidence.coverageSignal
          });
          if (!draftItem.excluded && draftItem.reviewRating) {
            const update = await applyTopicProjection(tx, {
              userId: user.id,
              quizId,
              gradeResultId: grade.id,
              topicId: evidence.topicId,
              reviewRating: draftItem.reviewRating,
              evidenceStrength: evidence.evidenceStrength,
              coverageSignal: evidence.coverageSignal,
              strengths: asArray<string>(draftItem.strengthsJson),
              weaknesses: asArray<string>(draftItem.weaknessesJson),
              misconceptions: asArray<string>(draftItem.misconceptionsJson)
            });
            updates.push(update);
            await upsertReviewState(tx, user.id, quizItem.questionId, evidence.topicId, draftItem.reviewRating);
          }
        }
        await tx.update(responses).set({ state: draftItem.excluded ? "excluded" : "finalized", updatedAt: new Date() }).where(eq(responses.id, response.id));
      }
      await tx.update(reviewDrafts).set({ finalizedAt: new Date(), updatedAt: new Date() }).where(eq(reviewDrafts.id, draft.id));
      await tx.update(quizzes).set({ status: "finalized", finalizedAt: new Date(), updatedAt: new Date() }).where(eq(quizzes.id, quizId));
      await insertActivity(tx, { userId: user.id, eventType: "review_finalized", entityType: "quiz", entityId: quizId, payload: { grade_count: results.length } });
      return { quiz_id: quizId, status: "finalized", grade_results: results, learner_model_updates: updates, results_ready: true };
    })
  );
}

async function applyTopicProjection(client: DbLike, input: {
  userId: string;
  quizId: string;
  gradeResultId: string;
  topicId: string;
  reviewRating: "Again" | "Hard" | "Good" | "Easy";
  evidenceStrength: number;
  coverageSignal: number;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
}) {
  const existing = await client.query.topicProfiles.findFirst({ where: and(eq(topicProfiles.userId, input.userId), eq(topicProfiles.topicId, input.topicId)) });
  const beforeKnowledge = existing?.knowledgeScore ?? 0;
  const beforeCoverage = existing?.coverageScore ?? 0;
  const alpha = clamp(0.1 + 0.2 * input.evidenceStrength, 0.1, 0.3);
  const afterKnowledge = clamp(beforeKnowledge + alpha * (ratingAnchor[input.reviewRating] - beforeKnowledge), 0, 1);
  const coverageDelta = (1 - beforeCoverage) * Math.min(0.08, input.coverageSignal * 0.12);
  const afterCoverage = clamp(beforeCoverage + coverageDelta, 0, 1);
  const strengths = [...new Set([...(asArray<string>(existing?.strengthsJson)), ...input.strengths])].slice(-20);
  const weaknesses = [...new Set([...(asArray<string>(existing?.weaknessesJson)), ...input.weaknesses])].slice(-20);
  const misconceptions = [...new Set([...(asArray<string>(existing?.activeMisconceptionsJson)), ...input.misconceptions])].slice(-20);
  await client
    .insert(topicProfiles)
    .values({
      userId: input.userId,
      topicId: input.topicId,
      overview: existing?.overview ?? "",
      knowledgeScore: afterKnowledge,
      coverageScore: afterCoverage,
      strengthsJson: strengths,
      weaknessesJson: weaknesses,
      activeMisconceptionsJson: misconceptions,
      recentQuizzesJson: [...asArray(existing?.recentQuizzesJson), input.quizId].slice(-10),
      lastReviewedAt: new Date(),
      evidenceCount: (existing?.evidenceCount ?? 0) + 1,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [topicProfiles.userId, topicProfiles.topicId],
      set: {
        knowledgeScore: afterKnowledge,
        coverageScore: afterCoverage,
        strengthsJson: strengths,
        weaknessesJson: weaknesses,
        activeMisconceptionsJson: misconceptions,
        recentQuizzesJson: [...asArray(existing?.recentQuizzesJson), input.quizId].slice(-10),
        lastReviewedAt: new Date(),
        evidenceCount: (existing?.evidenceCount ?? 0) + 1,
        updatedAt: new Date()
      }
    });
  const [update] = await client
    .insert(learnerModelUpdates)
    .values({
      userId: input.userId,
      quizId: input.quizId,
      gradeResultId: input.gradeResultId,
      topicId: input.topicId,
      beforeKnowledge,
      afterKnowledge,
      beforeCoverage,
      afterCoverage
    })
    .returning();
  return { topic_id: input.topicId, update_id: update.id, applied: true };
}

async function upsertReviewState(client: DbLike, userId: string, questionId: string, topicId: string, rating: "Again" | "Hard" | "Good" | "Easy") {
  const now = new Date();
  const dueAt = addDays(now, dueDays[rating]);
  await client
    .insert(userQuestionState)
    .values({ userId, questionId, lastReviewedAt: now, dueAt, lastRating: rating, reviewCount: 1 })
    .onConflictDoUpdate({
      target: [userQuestionState.userId, userQuestionState.questionId],
      set: { lastReviewedAt: now, dueAt, lastRating: rating, reviewCount: sql`${userQuestionState.reviewCount} + 1` }
    });
  await client
    .insert(userTopicReviewState)
    .values({ userId, topicId, lastReviewedAt: now, dueAt, lastRating: rating, reviewCount: 1 })
    .onConflictDoUpdate({
      target: [userTopicReviewState.userId, userTopicReviewState.topicId],
      set: { lastReviewedAt: now, dueAt, lastRating: rating, reviewCount: sql`${userTopicReviewState.reviewCount} + 1` }
    });
}

export async function getResponseGrades(responseId: string) {
  if (!isUuid(responseId)) notFound(`Response not found: ${responseId}`);
  const grades = await db.select().from(gradeResults).where(eq(gradeResults.responseId, responseId));
  return { grades: grades.map((grade) => ({ grade_id: grade.id, response_id: grade.responseId, review_rating: grade.reviewRating, evidence_score: grade.evidenceScore, overall_feedback: grade.overallFeedback, excluded: grade.excluded, created_at: grade.createdAt })) };
}

export async function getQuizResults(quizId: string) {
  const quiz = assertFound(await db.query.quizzes.findFirst({ where: eq(quizzes.id, quizId) }), "Quiz not found");
  if (quiz.status !== "finalized") return { quiz_id: quizId, status: quiz.status, results_ready: false };
  const draft = assertFound(await db.query.reviewDrafts.findFirst({ where: eq(reviewDrafts.quizId, quizId) }), "Review draft not found");
  const draftPayload = await getReviewDraft(quizId);
  const ratingCounts = { Again: 0, Hard: 0, Good: 0, Easy: 0 };
  for (const item of draftPayload.items) if (item.review_rating) ratingCounts[item.review_rating as keyof typeof ratingCounts] += 1;
  const updates = await db.select().from(learnerModelUpdates).where(eq(learnerModelUpdates.quizId, quizId));
  return {
    quiz_id: quizId,
    status: "finalized",
    results_ready: true,
    ...(draft.summaryJson as Record<string, unknown>),
    rating_counts: ratingCounts,
    items: draftPayload.items.map((item) => ({ quiz_item_id: item.quiz_item_id, outcome: item.outcome, feedback: item.overall_feedback, review_rating: item.review_rating })),
    topic_deltas: updates.map((update) => ({
      topic_id: update.topicId,
      before_knowledge: update.beforeKnowledge,
      after_knowledge: update.afterKnowledge,
      before_coverage: update.beforeCoverage,
      after_coverage: update.afterCoverage
    }))
  };
}

export async function getTopicProfile(idOrSlug: string) {
  const user = await getLocalUser();
  const topicId = await resolveTopicId(idOrSlug);
  const topic = await serializeTopic(topicId);
  const profile = await db.query.topicProfiles.findFirst({ where: and(eq(topicProfiles.userId, user.id), eq(topicProfiles.topicId, topicId)) });
  return {
    ...topic,
    overview: profile?.overview || topic.overview,
    knowledge_score: profile?.knowledgeScore ?? 0,
    coverage_score: profile?.coverageScore ?? 0,
    strengths: profile?.strengthsJson ?? [],
    weaknesses: profile?.weaknessesJson ?? [],
    active_misconceptions: profile?.activeMisconceptionsJson ?? [],
    recent_quizzes: profile?.recentQuizzesJson ?? [],
    last_reviewed_at: profile?.lastReviewedAt ?? null,
    evidence_count: profile?.evidenceCount ?? 0,
    next_recommended_topics: []
  };
}

export async function learnerSnapshot(input: { topic_ids: string[]; include_related?: boolean; include_prereqs?: boolean; limit_per_bucket?: number }) {
  const topicIds = [];
  for (const ref of input.topic_ids) topicIds.push(await resolveTopicId(ref));
  const profiles = await Promise.all(topicIds.map((id) => getTopicProfile(id)));
  const related = [];
  if (input.include_related || input.include_prereqs) {
    const edges = await db.select().from(topicEdges).where(or(inArray(topicEdges.fromTopicId, topicIds), inArray(topicEdges.toTopicId, topicIds)));
    for (const edge of edges.slice(0, input.limit_per_bucket ?? 10)) {
      const otherId = topicIds.includes(edge.fromTopicId) ? edge.toTopicId : edge.fromTopicId;
      const profile = await getTopicProfile(otherId);
      related.push({ ...profile, edge_type: edge.edgeType });
    }
  }
  const recentActivity = await activity({ topicId: topicIds[0], limit: input.limit_per_bucket ?? 10 });
  const reviewItemPayload = await reviewItems({ topicId: topicIds[0], limit: input.limit_per_bucket ?? 10 });
  return { topics: profiles, related_topics: related, recent_activity: recentActivity.items, review_items: reviewItemPayload.items };
}

export async function progressOverview() {
  const user = await getLocalUser();
  const rows = await db
    .select({
      topicId: topics.id,
      slug: topics.slug,
      title: topics.title,
      knowledgeScore: topicProfiles.knowledgeScore,
      coverageScore: topicProfiles.coverageScore,
      evidenceCount: topicProfiles.evidenceCount
    })
    .from(topicProfiles)
    .innerJoin(topics, eq(topicProfiles.topicId, topics.id))
    .where(eq(topicProfiles.userId, user.id));
  const byKnowledgeDesc = [...rows].sort((a, b) => b.knowledgeScore - a.knowledgeScore);
  const byKnowledgeAsc = [...rows].sort((a, b) => a.knowledgeScore - b.knowledgeScore);
  const byCoverageAsc = [...rows].sort((a, b) => a.coverageScore - b.coverageScore);
  return {
    global_overview: "Deterministic projection over finalized quiz evidence.",
    strongest_topics: byKnowledgeDesc.slice(0, 10).map(topicSummary),
    weakest_topics: byKnowledgeAsc.slice(0, 10).map(topicSummary),
    underexplored_topics: byCoverageAsc.slice(0, 10).map(topicSummary),
    most_reviewed_topics: [...rows].sort((a, b) => b.evidenceCount - a.evidenceCount).slice(0, 10).map((row) => ({ topic_id: row.slug, review_count: row.evidenceCount })),
    recent_misconceptions: []
  };
}

function topicSummary(row: { slug: string; knowledgeScore: number; coverageScore: number }) {
  return { topic_id: row.slug, knowledge_score: row.knowledgeScore, coverage_score: row.coverageScore };
}

export async function reviewItems(filters: { topicId?: string | null; limit?: number }) {
  const user = await getLocalUser();
  const limit = filters.limit ?? 20;
  const topicId = filters.topicId ? await resolveTopicId(filters.topicId) : null;
  const rows = await db
    .select({
      questionId: questions.id,
      questionSlug: questions.slug,
      topicId: questionTopics.topicId,
      dueAt: userQuestionState.dueAt,
      lastRating: userQuestionState.lastRating
    })
    .from(userQuestionState)
    .innerJoin(questions, eq(userQuestionState.questionId, questions.id))
    .leftJoin(questionTopics, eq(questionTopics.questionId, questions.id))
    .where(and(eq(userQuestionState.userId, user.id), ...(topicId ? [eq(questionTopics.topicId, topicId)] : [])))
    .orderBy(asc(userQuestionState.dueAt))
    .limit(limit);
  return {
    items: await Promise.all(rows.map(async (row) => ({
      question_id: row.questionSlug ?? row.questionId,
      topic_ids: row.topicId ? [row.topicId] : [],
      question_tags: await getQuestionTags(row.questionId),
      due_at: row.dueAt,
      last_rating: row.lastRating
    })))
  };
}

export async function activity(filters: { topicId?: string | null; limit?: number }) {
  const limit = filters.limit ?? 50;
  const topicId = filters.topicId ? await resolveTopicId(filters.topicId) : null;
  const readLimit = topicId ? Math.max(limit * 20, 200) : limit;
  const rows = await db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(readLimit);
  const scopedRows = [];
  for (const row of rows) {
    if (!topicId || await activityEventMatchesTopic(row, topicId)) scopedRows.push(row);
    if (scopedRows.length >= limit) break;
  }
  return { items: scopedRows.map((row) => ({ event_id: row.id, event_type: row.eventType, entity_type: row.entityType, entity_id: row.entityId, created_at: row.createdAt, ...(row.payloadJson as Record<string, unknown>) })) };
}

async function activityEventMatchesTopic(row: typeof activityEvents.$inferSelect, topicId: string) {
  if (!row.entityId) return false;
  if (row.entityType === "topic") return row.entityId === topicId;
  if (row.entityType === "quiz") {
    const quiz = await db.query.quizzes.findFirst({ where: eq(quizzes.id, row.entityId) });
    return quiz ? asArray<string>(quiz.topicIdsSnapshot).includes(topicId) : false;
  }
  if (row.entityType === "response") {
    const response = await db.query.responses.findFirst({ where: eq(responses.id, row.entityId) });
    if (!response) return false;
    const item = await db.query.quizItems.findFirst({ where: eq(quizItems.id, response.quizItemId) });
    return item ? asArray<string>(item.topicIdsSnapshot).includes(topicId) : false;
  }
  if (row.entityType === "question") {
    const linked = await db.query.questionTopics.findFirst({ where: and(eq(questionTopics.questionId, row.entityId), eq(questionTopics.topicId, topicId)) });
    return Boolean(linked);
  }
  return false;
}

export async function learnerModelUpdateList(filters: { status?: string | null; limit?: number }) {
  const limit = filters.limit ?? 20;
  const rows = await db.select().from(learnerModelUpdates).where(filters.status ? eq(learnerModelUpdates.status, filters.status) : undefined).orderBy(desc(learnerModelUpdates.createdAt)).limit(limit);
  return { updates: rows.map((row) => ({ update_id: row.id, quiz_id: row.quizId, status: row.status, topic_ids: [row.topicId], created_at: row.createdAt, applied_at: row.appliedAt })) };
}

export async function createQuizFeedback(quizId: string, input: { quiz_item_id?: string | null; feedback_type?: string; feedback_text: string }) {
  const user = await getLocalUser();
  const [feedback] = await db.insert(quizFeedback).values({ userId: user.id, quizId, quizItemId: input.quiz_item_id ?? null, feedbackType: input.feedback_type ?? "general", feedbackText: input.feedback_text }).returning();
  await insertActivity(db, { userId: user.id, eventType: "quiz_feedback_submitted", entityType: "quiz", entityId: quizId, payload: { feedback_id: feedback.id } });
  return { feedback_id: feedback.id, event_id: feedback.id, recorded: true };
}

export async function createTopicProposal(input: { proposal_type: string; topic?: unknown; edge?: unknown; tags?: string[]; reason?: string; supporting_signals?: string[]; status?: "pending" | "approved" | "rejected" }) {
  const user = await getLocalUser();
  const [proposal] = await db.insert(topicProposals).values({
    userId: user.id,
    proposalType: input.proposal_type,
    topicJson: input.topic ?? null,
    edgeJson: input.edge ?? null,
    tagsJson: input.tags ?? null,
    reason: input.reason ?? "",
    supportingSignalsJson: input.supporting_signals ?? [],
    status: input.status ?? "pending"
  }).returning();
  return { proposal_id: proposal.id, saved: true, status: proposal.status };
}

export async function listTopicProposals(status?: string | null) {
  const rows = await db.select().from(topicProposals).where(status ? eq(topicProposals.status, status as "pending" | "approved" | "rejected") : undefined).orderBy(desc(topicProposals.createdAt));
  return { proposals: rows.map((row) => ({ proposal_id: row.id, proposal_type: row.proposalType, topic: row.topicJson, edge: row.edgeJson, tags: row.tagsJson, reason: row.reason, supporting_signals: row.supportingSignalsJson, status: row.status })) };
}

export async function decideTopicProposal(proposalId: string, input: { decision: "approve" | "reject"; reason?: string }) {
  const status = input.decision === "approve" ? "approved" : "rejected";
  const [proposal] = await db.update(topicProposals).set({ status, decisionReason: input.reason ?? null, decidedAt: new Date() }).where(eq(topicProposals.id, proposalId)).returning();
  return { proposal_id: assertFound(proposal, "Topic proposal not found").id, status };
}

export async function searchReferences(query: string | null, limit = 10) {
  const q = query?.trim();
  const rows = q
    ? await db.select().from(referenceChunks).innerJoin(references, eq(referenceChunks.referenceId, references.id)).where(or(ilike(referenceChunks.chunkText, `%${q}%`), ilike(references.title, `%${q}%`))).limit(limit)
    : await db.select().from(referenceChunks).innerJoin(references, eq(referenceChunks.referenceId, references.id)).limit(limit);
  return {
    results: rows.map((row) => ({ source_id: row.reference_chunks.id, title: row.reference_sources.title, snippet: row.reference_chunks.snippet || row.reference_chunks.chunkText.slice(0, 180), path_or_url: row.reference_sources.pathOrUrl }))
  };
}

export async function createReference(input: { slug?: string; title: string; path_or_url: string; chunks?: Array<{ heading?: string; text: string; snippet?: string }> }) {
  return await db.transaction(async (tx) => {
    const [reference] = await tx.insert(references).values({ slug: input.slug ?? slugify(input.title), title: input.title, pathOrUrl: input.path_or_url }).returning();
    for (const chunkInput of input.chunks ?? []) {
      const [chunk] = await tx.insert(referenceChunks).values({ referenceId: reference.id, heading: chunkInput.heading ?? null, chunkText: chunkInput.text, snippet: chunkInput.snippet ?? chunkInput.text.slice(0, 180) }).returning();
      await upsertEmbedding(tx, "reference", chunk.id, await canonicalReferenceChunkText(chunk.id, tx));
    }
    return { reference_id: reference.id, created: true };
  });
}
