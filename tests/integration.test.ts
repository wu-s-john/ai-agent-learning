import { existsSync } from "node:fs";
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
  learnerSnapshot,
  patchReviewDraft,
  saveResponseDraft,
  searchQuestions,
  searchTopics,
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

  it("models the AI preparing a quiz from topic search, learner snapshot, retrieval metadata, generated questions, and quiz snapshots", async () => {
    // [User -> AI] "Quiz me on topology."
    // [AI -> Server] Search/create the topic scope.
    await createTopic({ slug: "quiz_prep_topology", title: "Quiz Prep Topology", tags: ["topology"] });
    await createTopic({ slug: "quiz_prep_open_sets", title: "Quiz Prep Open Sets", tags: ["topology"] });
    const topicMatches = await searchTopics("Quiz Prep Topology", 10);
    expect(topicMatches.matches.some((match) => match.topic_id === "quiz_prep_topology")).toBe(true);

    // [AI -> Server] Get raw learner state for the topic neighborhood.
    const snapshotBefore = await learnerSnapshot({
      topic_ids: ["quiz_prep_topology"],
      include_related: true,
      include_prereqs: true,
      limit_per_bucket: 10
    });
    expect(snapshotBefore.topics[0]?.knowledge_score).toBe(0);

    // [AI -> Server] Create one existing reusable question in the pool.
    const existingQuestion = await createQuestion({
      slug: "quiz_prep_existing_open_sets",
      topic_ids: ["quiz_prep_topology", "quiz_prep_open_sets"],
      question_tags: ["definition", "diagnostic"],
      modality: "free_response",
      prompt: "Define an open set in a topology.",
      difficulty: 0.55,
      quality_score: 0.8
    });

    // [AI -> Server] Retrieve existing questions with query-time retrieval metadata.
    const retrieved = await searchQuestions("open set topology", {
      topicId: "quiz_prep_topology",
      tag: "definition",
      difficultyTarget: 0.6,
      includeDue: true,
      limit: 10
    });
    const retrievedQuestion = retrieved.questions.find((question) => question.id === existingQuestion.id);
    expect(retrievedQuestion).toBeDefined();
    if (!retrievedQuestion) throw new Error("retrieved question missing");
    expect(retrievedQuestion.retrieval_score).toBeGreaterThan(0);
    expect(retrievedQuestion.retrieval_signals.topic_match).toBe(true);
    expect(retrievedQuestion.retrieval_signals.tag_overlap).toBe(1);
    expect(retrievedQuestion.retrieval_signals.difficulty_distance).toBeCloseTo(0.05);
    expect(retrievedQuestion.retrieval_signals.quality_score).toBe(0.8);
    expect(retrievedQuestion.due).toBe(false);

    // [AI -> Server] Retrieval does not update the learner model.
    const snapshotAfterRetrieval = await learnerSnapshot({
      topic_ids: ["quiz_prep_topology"],
      include_related: true,
      include_prereqs: true,
      limit_per_bucket: 10
    });
    expect(snapshotAfterRetrieval.topics[0]?.knowledge_score).toBe(0);
    expect(snapshotAfterRetrieval.topics[0]?.coverage_score).toBe(0);

    // [AI -> Server] Create a missing generated question as a normal active tagged question.
    const generatedQuestion = await createQuestion({
      slug: "quiz_prep_generated_open_sets_vs_basis",
      topic_ids: ["quiz_prep_topology", "quiz_prep_open_sets"],
      question_tags: ["generated", "conceptual", "diagnostic"],
      modality: "free_response",
      prompt: "Explain how open sets differ from a basis for a topology.",
      difficulty: 0.7,
      quality_score: 0.6,
      created_by: "ai",
      provenance: { generated_for: "quiz_prep_topology" }
    });
    expect(generatedQuestion.status).toBe("active");
    expect(generatedQuestion.topic_ids).toHaveLength(2);
    expect(generatedQuestion.question_tags).toEqual(expect.arrayContaining(["generated", "conceptual", "diagnostic"]));

    // [AI -> Server] Create the quiz from selected question refs.
    const quiz = await createQuiz({
      topic_ids: ["quiz_prep_topology"],
      purpose: "diagnosis",
      mode: "mixed",
      difficulty_target: 0.65,
      answer_reveal_policy: "after_quiz",
      question_refs: [
        { question_id: existingQuestion.id, order: 1 },
        { question_id: generatedQuestion.id, order: 2 }
      ]
    });

    // [Server -> AI] Return ordered quiz items with snapshots.
    expect(quiz.items).toHaveLength(2);
    expect(quiz.items?.[0]?.question_id).toBe(existingQuestion.id);
    expect(quiz.items?.[0]?.question_tags).toContain("definition");
    expect(quiz.items?.[1]?.question_id).toBe(generatedQuestion.id);
    expect(quiz.items?.[1]?.question_tags).toContain("generated");
    expect(quiz.items?.[1]?.topic_ids).toHaveLength(2);
  });

  it("does not expose a parallel questions candidates endpoint", () => {
    // [AI -> Server] Quiz-planning retrieval should use GET /api/questions, not POST /api/questions/candidates.
    expect(existsSync("app/api/questions/candidates/route.ts")).toBe(false);
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
