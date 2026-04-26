import { beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "@/src/db/client";
import "@/src/db/schema";
import { createQuestion, createQuiz, createReviewDraft, createTopic, finalizeReviewDraft, saveResponseDraft, submitQuizResponses } from "@/src/server/services";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!runDbTests)("database quiz lifecycle", () => {
  beforeAll(async () => {
    await sqlClient`TRUNCATE TABLE idempotency_keys, learner_model_updates, grade_topic_evidence, grade_results, review_draft_topic_evidence, review_draft_items, review_drafts, responses, quiz_items, quizzes, question_embeddings, question_tags, question_topics, questions, topic_embeddings, topic_edges, topic_tags, topic_aliases, topic_profiles, user_question_state, user_topic_review_state, activity_events, quiz_feedback, topic_proposals, users, reference_sources, reference_chunks, reference_embeddings RESTART IDENTITY CASCADE`;
  });

  it("creates and finalizes a quiz without rubrics", async () => {
    await createTopic({ slug: "compactness", title: "Compactness", tags: ["topology"] });
    const question = await createQuestion({
      slug: "compactness_definition",
      topic_ids: ["compactness"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "State compactness using open covers."
    });
    const quiz = await createQuiz({
      topic_ids: ["compactness"],
      question_refs: [{ question_id: question.id, order: 1 }],
      answer_reveal_policy: "after_quiz"
    });
    const item = quiz.items?.[0];
    expect(item).toBeDefined();
    if (!item) throw new Error("quiz item missing");
    await saveResponseDraft(item.quiz_item_id, { outcome: "no_answer", answer_text: null });
    const draft = await saveResponseDraft(item.quiz_item_id, {
      outcome: "answered",
      answer_text: "Every open cover has a finite subcover."
    });
    const submitted = await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "submit-1",
      submitted_from: "test"
    });
    expect(submitted.responses[0].outcome).toBe("answered");
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "draft-1",
      summary: { overview: "Good compactness definition." },
      items: [{
        response_id: draft.response_id,
        outcome: "answered",
        overall_feedback: "Correct.",
        review_rating: "Good",
        evidence_score: 0.8,
        topic_evidence: [{ topic_id: "compactness", evidence_strength: 0.8, coverage_signal: 0.4 }]
      }]
    });
    const finalized = await finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-1" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.learner_model_updates).toHaveLength(1);
  });

  it("updates a slugged question idempotently", async () => {
    await createTopic({ slug: "open_sets", title: "Open Sets", tags: ["topology"] });
    const first = await createQuestion({
      slug: "open_sets_definition",
      topic_ids: ["open_sets"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "Define an open set."
    });
    const second = await createQuestion({
      slug: "open_sets_definition",
      topic_ids: ["open_sets"],
      question_tags: ["definition", "conceptual"],
      modality: "free_response",
      prompt: "Define an open set in a topology."
    });
    expect(second.id).toBe(first.id);
    expect(second.prompt).toBe("Define an open set in a topology.");
    expect(second.question_tags).toEqual(["definition", "conceptual"]);
  });

  it("blocks finalization when a draft item needs AI re-review", async () => {
    await createTopic({ slug: "basis_topology", title: "Basis for a Topology", tags: ["topology"] });
    const question = await createQuestion({
      slug: "basis_definition",
      topic_ids: ["basis_topology"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "What is a basis for a topology?"
    });
    const quiz = await createQuiz({
      topic_ids: ["basis_topology"],
      question_refs: [{ question_id: question.id, order: 1 }]
    });
    const item = quiz.items?.[0];
    if (!item) throw new Error("quiz item missing");
    const response = await saveResponseDraft(item.quiz_item_id, {
      outcome: "answered",
      answer_text: "A collection of sets used to generate opens."
    });
    await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "submit-rereview",
      submitted_from: "test"
    });
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "draft-rereview",
      summary: {},
      items: [{
        response_id: response.response_id,
        outcome: "answered",
        overall_feedback: "Needs another look.",
        review_rating: "Hard",
        evidence_score: 0.5,
        needs_ai_re_review: true,
        topic_evidence: [{ topic_id: "basis_topology", evidence_strength: 0.5, coverage_signal: 0.2 }]
      }]
    });
    await expect(finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-rereview" })).rejects.toThrow(/re-review/);
  });
});
