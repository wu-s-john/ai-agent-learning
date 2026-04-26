import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const tagsSchema = z.array(z.string().trim().min(1)).default([]);

export const questionModalitySchema = z.enum(["mcq", "free_response", "explain_back"]);
export const questionStatusSchema = z.enum(["active", "retired"]);
export const reviewRatingSchema = z.enum(["Again", "Hard", "Good", "Easy"]);
export const outcomeSchema = z.enum(["answered", "skipped", "no_answer", "timed_out", "abandoned", "excluded"]);
export const answerRevealPolicySchema = z.enum(["after_each_item", "after_quiz", "never_in_chat"]);
export const edgeTypeSchema = z.enum(["prereq_of", "part_of", "related_to"]);

export const createTopicSchema = z.object({
  topic_id: z.string().optional(),
  slug: z.string().optional(),
  title: z.string().min(1),
  overview: z.string().default(""),
  tags: tagsSchema,
  aliases: tagsSchema
});

export const patchTopicSchema = z.object({
  slug: z.string().optional(),
  title: z.string().optional(),
  overview: z.string().optional(),
  aliases: tagsSchema.optional()
});

export const createQuestionSchema = z.object({
  question_id: z.string().optional(),
  slug: z.string().optional(),
  topic_ids: z.array(z.string()).default([]),
  question_tags: tagsSchema,
  modality: questionModalitySchema,
  status: questionStatusSchema.default("active"),
  prompt: z.string().min(1),
  answer_key: z.unknown().nullable().optional(),
  answer_key_json: z.unknown().nullable().optional(),
  difficulty: z.number().min(0).max(1).default(0.5),
  quality_score: z.number().min(0).max(1).default(0.5),
  created_by: z.string().default("ai"),
  provenance: z.record(z.string(), z.unknown()).default({})
});

export const patchQuestionSchema = z.object({
  slug: z.string().nullable().optional(),
  prompt: z.string().optional(),
  modality: questionModalitySchema.optional(),
  status: questionStatusSchema.optional(),
  answer_key: z.unknown().nullable().optional(),
  answer_key_json: z.unknown().nullable().optional(),
  difficulty: z.number().min(0).max(1).optional(),
  quality_score: z.number().min(0).max(1).optional(),
  topic_ids: z.array(z.string()).optional(),
  question_tags: z.array(z.string()).optional()
});

export const createQuizSchema = z.object({
  slug: z.string().optional(),
  quiz_type: z.string().default("standard"),
  topic_ids: z.array(z.string()).default([]),
  mode: z.string().default("mixed"),
  purpose: z.string().nullable().optional(),
  grading_posture: z.string().nullable().optional(),
  difficulty_target: z.number().min(0).max(1).nullable().optional(),
  hint_policy: z.string().nullable().optional(),
  answer_reveal_policy: answerRevealPolicySchema.default("after_quiz"),
  time_pressure: z.unknown().nullable().optional(),
  question_refs: z.array(z.object({ question_id: z.string(), order: z.number().int().positive() })).min(1)
});

export const responseDraftSchema = z.object({
  outcome: outcomeSchema,
  answer_text: z.string().nullable().optional(),
  image_refs: z.array(z.string()).default([]),
  submitted_from: z.string().default("chat"),
  answer_reveal_policy: answerRevealPolicySchema.optional()
});

export const submitResponsesSchema = z.object({
  idempotency_key: z.string().min(1),
  submitted_from: z.string().default("chat")
});

const topicEvidenceSchema = z.object({
  topic_id: z.string(),
  evidence_strength: z.number().min(0).max(1),
  coverage_signal: z.number().min(0).max(1)
});

export const createReviewDraftSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  summary: z.record(z.string(), z.unknown()).default({}),
  items: z.array(
    z.object({
      response_id: z.string(),
      outcome: outcomeSchema,
      overall_feedback: z.string().default(""),
      review_rating: reviewRatingSchema.nullable().optional(),
      evidence_score: z.number().min(0).max(1).default(0),
      strengths: z.array(z.string()).default([]),
      weaknesses: z.array(z.string()).default([]),
      misconceptions: z.array(z.string()).default([]),
      topic_evidence: z.array(topicEvidenceSchema).default([]),
      excluded: z.boolean().default(false),
      needs_ai_re_review: z.boolean().default(false)
    })
  )
});

export const patchReviewDraftSchema = z.object({
  summary: z.record(z.string(), z.unknown()).optional(),
  items: z.array(
    z.object({
      review_draft_item_id: z.string(),
      overall_feedback: z.string().optional(),
      learner_note: z.string().nullable().optional(),
      dispute_reason: z.string().nullable().optional(),
      excluded: z.boolean().optional()
    })
  ).default([])
});

export const finalizeReviewSchema = z.object({
  idempotency_key: z.string().min(1)
});

export const feedbackSchema = z.object({
  feedback_text: z.string().min(1),
  quiz_item_id: z.string().nullable().optional(),
  feedback_type: z.string().default("general")
});

export const learnerSnapshotSchema = z.object({
  topic_ids: z.array(z.string()).default([]),
  include_related: z.boolean().default(false),
  include_prereqs: z.boolean().default(false),
  limit_per_bucket: z.number().int().positive().max(100).default(10)
});

export const topicProposalSchema = z.object({
  proposal_type: z.string().min(1),
  topic: z.unknown().optional(),
  edge: z.unknown().optional(),
  tags: z.array(z.string()).optional(),
  reason: z.string().default(""),
  supporting_signals: z.array(z.string()).default([]),
  status: z.enum(["pending", "approved", "rejected"]).default("pending")
});
