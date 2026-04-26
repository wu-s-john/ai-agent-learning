import { beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "@/src/db/client";
import "@/src/db/schema";
import {
  createQuestion,
  createQuiz,
  createReviewDraft,
  createTopic,
  finalizeReviewDraft,
  getQuizResults,
  getReviewDraft,
  getTopicProfile,
  patchReviewDraft,
  saveResponseDraft,
  submitQuizResponses
} from "@/src/server/services";

async function resetIntegrationDatabase() {
  await sqlClient`TRUNCATE TABLE idempotency_keys, learner_model_updates, grade_topic_evidence, grade_results, review_draft_topic_evidence, review_draft_items, review_drafts, responses, quiz_items, quizzes, question_embeddings, question_tags, question_topics, questions, topic_embeddings, topic_edges, topic_tags, topic_aliases, topic_profiles, user_question_state, user_topic_review_state, activity_events, quiz_feedback, topic_proposals, users, reference_sources, reference_chunks, reference_embeddings RESTART IDENTITY CASCADE`;
}

describe("User-AI-Server integration workflows", () => {
  beforeAll(async () => {
    await resetIntegrationDatabase();
  });

  it("models a full quiz where the AI uses fixture review JSON and the server updates learner knowledge", async () => {
    // [User -> AI] "Quiz me on compactness."
    // [AI -> Server] Ensure the topic and a tagged question exist.
    await createTopic({ slug: "compactness", title: "Compactness", tags: ["topology"] });
    const question = await createQuestion({
      slug: "compactness_definition",
      topic_ids: ["compactness"],
      question_tags: ["definition", "open-cover"],
      modality: "free_response",
      prompt: "State compactness using open covers."
    });
    expect(question.question_tags).toEqual(["definition", "open-cover"]);
    expect(question.answer_key).toBeNull();

    // [AI -> Server] Create the quiz from question-pool refs.
    const quiz = await createQuiz({
      topic_ids: ["compactness"],
      purpose: "diagnosis",
      grading_posture: "strict",
      answer_reveal_policy: "after_quiz",
      question_refs: [{ question_id: question.id, order: 1 }]
    });
    const item = quiz.items?.[0];
    expect(item).toBeDefined();
    if (!item) throw new Error("quiz item missing");
    expect(quiz.answer_reveal_policy).toBe("after_quiz");

    // [AI -> Server] Mark the shown item as durable no-answer evidence before the learner responds.
    const shownDraft = await saveResponseDraft(item.quiz_item_id, { outcome: "no_answer", answer_text: null });
    expect(shownDraft.outcome).toBe("no_answer");

    // [User -> AI] The learner answers.
    // [AI -> Server] Save the response draft without revealing correctness.
    const answeredDraft = await saveResponseDraft(item.quiz_item_id, {
      outcome: "answered",
      answer_text: "Every open cover has a finite subcover.",
      answer_reveal_policy: "after_quiz"
    });
    expect(answeredDraft.response_state).toBe("draft");

    // [User -> AI] The learner ends the quiz.
    // [AI -> Server] Submit all saved response drafts for review.
    const submitted = await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "submit-compactness",
      submitted_from: "test"
    });
    expect(submitted.status).toBe("responses_submitted");
    expect(submitted.review_payload[0]?.response.answer_text).toContain("finite subcover");

    // [AI -> AI] Fixture JSON stands in for the LLM review/grading actor.
    // [AI -> Server] Store the mutable review draft.
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "draft-compactness",
      summary: {
        overview: "Good compactness definition.",
        strengths: ["Correct open-cover definition"],
        weaknesses: [],
        improvement_targets: ["open_covers"]
      },
      items: [{
        response_id: answeredDraft.response_id,
        outcome: "answered",
        overall_feedback: "Correct. You included open covers and finite subcovers.",
        review_rating: "Good",
        evidence_score: 0.82,
        strengths: ["Correct formal definition"],
        weaknesses: [],
        misconceptions: [],
        topic_evidence: [{ topic_id: "compactness", evidence_strength: 0.82, coverage_signal: 0.4 }]
      }]
    });
    const reviewDraft = await getReviewDraft(quiz.quiz_id);
    expect(reviewDraft.status).toBe("review_drafted");
    expect(reviewDraft.items[0]?.review_rating).toBe("Good");

    // [Next.js UI -> Server] Finalize the staged review.
    const finalized = await finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-compactness" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.learner_model_updates).toHaveLength(1);

    // [AI or UI -> Server] Read finalized results and topic profile projections.
    const results = await getQuizResults(quiz.quiz_id);
    expect(results.results_ready).toBe(true);
    if (!("rating_counts" in results)) throw new Error("quiz results were not finalized");
    expect(results.rating_counts.Good).toBe(1);
    const profile = await getTopicProfile("compactness");
    expect(profile.knowledge_score).toBeGreaterThan(0);
    expect(profile.coverage_score).toBeGreaterThan(0);
    expect(profile.strengths).toContain("Correct formal definition");
  });

  it("models the AI maintaining reusable tagged questions across multiple topics", async () => {
    // [User -> AI] "Challenge me on how compactness depends on open covers."
    // [AI -> Server] Create the ontology slice and a multi-topic question.
    await createTopic({ slug: "question_authoring_compactness", title: "Question Authoring Compactness", tags: ["topology"] });
    await createTopic({ slug: "question_authoring_open_covers", title: "Question Authoring Open Covers", tags: ["topology"] });

    const first = await createQuestion({
      slug: "question_authoring_open_cover_prompt",
      topic_ids: ["question_authoring_compactness", "question_authoring_open_covers"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "Define compactness using open covers."
    });

    // [AI -> Server] Upsert the same reusable question as the prompt improves.
    const second = await createQuestion({
      slug: "question_authoring_open_cover_prompt",
      topic_ids: ["question_authoring_compactness", "question_authoring_open_covers"],
      question_tags: ["definition", "diagnostic", "open-cover"],
      modality: "free_response",
      prompt: "Explain compactness using open covers, and name the finite-subcover condition."
    });

    expect(second.id).toBe(first.id);
    expect(second.topic_ids).toHaveLength(2);
    expect(second.question_tags).toEqual(["definition", "diagnostic", "open-cover"]);
    expect(second.prompt).toContain("finite-subcover");
  });

  it("models learner review of AI feedback and blocks finalization when re-review is needed", async () => {
    // [User -> AI] "Quiz me on bases for topology."
    // [AI -> Server] Create a quiz and persist the learner's answer.
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
      idempotency_key: "submit-basis",
      submitted_from: "test"
    });

    // [AI -> AI] Fixture JSON stands in for an initial LLM review.
    // [AI -> Server] Store staged feedback that the learner may inspect.
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "draft-basis",
      summary: {},
      items: [{
        response_id: response.response_id,
        outcome: "answered",
        overall_feedback: "Partially correct, but missing the basis union and intersection conditions.",
        review_rating: "Hard",
        evidence_score: 0.5,
        topic_evidence: [{ topic_id: "basis_topology", evidence_strength: 0.5, coverage_signal: 0.2 }]
      }]
    });
    const draft = await getReviewDraft(quiz.quiz_id);
    const draftItem = draft.items[0];
    expect(draftItem).toBeDefined();
    if (!draftItem) throw new Error("review draft item missing");

    // [Learner -> Next.js UI] Dispute the AI feedback.
    // [Next.js UI -> Server] Save the dispute as a safe staged edit.
    const patched = await patchReviewDraft(quiz.quiz_id, {
      items: [{
        review_draft_item_id: draftItem.review_draft_item_id,
        dispute_reason: "I think I did mention generation, but the feedback may be too harsh."
      }]
    });
    expect(patched.needs_ai_re_review).toBe(true);

    // [Next.js UI -> Server] Finalization is blocked until the AI re-reviews or the item is excluded.
    await expect(finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-basis" })).rejects.toThrow(/re-review/);
  });
});
