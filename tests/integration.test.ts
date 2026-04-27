import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "@/src/db/client";
import "@/src/db/schema";
import {
  activity,
  createQuestion,
  createQuiz,
  createReviewDraft,
  createTopic,
  finalizeReviewDraft,
  getQuizItems,
  getQuizResults,
  getReviewDraft,
  getResponse,
  getResponseGrades,
  getTopicProfile,
  learnerSnapshot,
  learnerModelUpdateList,
  patchReviewDraft,
  reviewItems,
  saveResponseDraft,
  searchQuestions,
  searchTopics,
  submitQuizResponses
} from "@/src/server/services";

async function resetIntegrationDatabase() {
  await sqlClient`TRUNCATE TABLE idempotency_keys, learner_model_updates, grade_topic_evidence, grade_results, review_draft_topic_evidence, review_draft_items, review_drafts, responses, quiz_items, quizzes, question_embeddings, question_tags, question_topics, questions, topic_embeddings, topic_edges, topic_tags, topic_aliases, topic_profiles, user_question_state, user_topic_review_state, activity_events, quiz_feedback, topic_proposals, users, reference_sources, reference_chunks, reference_embeddings RESTART IDENTITY CASCADE`;
}

async function createSubmittedSingleItemQuiz(input: {
  topicSlug: string;
  questionSlug: string;
  prompt?: string;
  outcome?: "answered" | "skipped" | "no_answer" | "timed_out" | "abandoned" | "excluded";
  answerText?: string | null;
  submitKey: string;
}) {
  await createTopic({ slug: input.topicSlug, title: input.topicSlug.replaceAll("_", " "), tags: ["topology"] });
  const question = await createQuestion({
    slug: input.questionSlug,
    topic_ids: [input.topicSlug],
    question_tags: ["definition"],
    modality: "free_response",
    prompt: input.prompt ?? "Define the target concept."
  });
  const quiz = await createQuiz({
    topic_ids: [input.topicSlug],
    question_refs: [{ question_id: question.id, order: 1 }]
  });
  const items = await getQuizItems(quiz.quiz_id);
  const response = await saveResponseDraft(items.items[0]!.quiz_item_id, {
    outcome: input.outcome ?? "answered",
    answer_text: input.answerText ?? "A correct enough answer."
  });
  const submitted = await submitQuizResponses(quiz.quiz_id, {
    idempotency_key: input.submitKey,
    submitted_from: "test"
  });
  return { quiz, question, response, submitted };
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

  it("models navigation, draft answer revision, submission, and staged AI review without learner-model updates", async () => {
    // [User -> AI] "Quiz me on compactness."
    // [AI -> Server] Create topic/questions/quiz.
    await createTopic({ slug: "answer_pipeline_compactness", title: "Answer Pipeline Compactness", tags: ["topology"] });
    const definitionQuestion = await createQuestion({
      slug: "answer_pipeline_compactness_definition",
      topic_ids: ["answer_pipeline_compactness"],
      question_tags: ["definition", "open-cover"],
      modality: "free_response",
      prompt: "State compactness using open covers."
    });
    const exampleQuestion = await createQuestion({
      slug: "answer_pipeline_compactness_example",
      topic_ids: ["answer_pipeline_compactness"],
      question_tags: ["example"],
      modality: "free_response",
      prompt: "Give an example of a compact space."
    });
    const quiz = await createQuiz({
      topic_ids: ["answer_pipeline_compactness"],
      answer_reveal_policy: "after_quiz",
      question_refs: [
        { question_id: definitionQuestion.id, order: 1 },
        { question_id: exampleQuestion.id, order: 2 }
      ]
    });

    // [AI -> Server] Navigate from ordered quiz items; no /next endpoint is needed.
    const itemsBefore = await getQuizItems(quiz.quiz_id);
    expect(itemsBefore.items).toHaveLength(2);
    expect(itemsBefore.items[0]?.outcome).toBeNull();
    expect(itemsBefore.items[1]?.outcome).toBeNull();

    // [AI -> Server] Mark the shown item as no_answer so it differs from never-shown items.
    const shownDraft = await saveResponseDraft(itemsBefore.items[0]!.quiz_item_id, {
      outcome: "no_answer",
      answer_text: null,
      answer_reveal_policy: "after_quiz"
    });
    expect(shownDraft.outcome).toBe("no_answer");

    // [User -> AI] Learner answers, then revises before submission.
    const firstAnswer = await saveResponseDraft(itemsBefore.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "A space is compact if every open cover has a finite subcover.",
      answer_reveal_policy: "after_quiz"
    });
    const revisedAnswer = await saveResponseDraft(itemsBefore.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "Every open cover of the space has a finite subcover.",
      answer_reveal_policy: "after_quiz"
    });
    expect(revisedAnswer.response_id).toBe(firstAnswer.response_id);
    expect(revisedAnswer.response_state).toBe("draft");

    const itemsAfterRevision = await getQuizItems(quiz.quiz_id);
    expect(itemsAfterRevision.items[0]?.outcome).toBe("answered");
    expect(itemsAfterRevision.items[0]?.response_state).toBe("draft");
    expect(itemsAfterRevision.items[1]?.response_id).toBeNull();

    // [User -> AI] Learner ends the quiz early.
    // [AI -> Server] Submit only presented items with saved outcomes.
    const submitted = await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "answer-pipeline-submit",
      submitted_from: "test"
    });
    expect(submitted.status).toBe("responses_submitted");
    expect(submitted.review_payload).toHaveLength(1);
    expect(submitted.review_payload[0]?.response.answer_text).toBe("Every open cover of the space has a finite subcover.");
    expect(submitted.review_payload[0]?.question.prompt).toBe("State compactness using open covers.");

    // [AI -> Server] Draft response edits are locked after submission.
    await expect(saveResponseDraft(itemsBefore.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "Trying to edit after submit."
    })).rejects.toThrow(/Cannot edit responses after quiz responses are submitted/);

    // [AI -> AI] Fixture JSON stands in for LLM review/grading.
    // [AI -> Server] Store staged review draft; this is not final evidence yet.
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "answer-pipeline-review-draft",
      summary: {
        overview: "Correct compactness definition.",
        strengths: ["Open-cover definition"],
        weaknesses: []
      },
      items: [{
        response_id: submitted.review_payload[0]!.response_id,
        outcome: "answered",
        overall_feedback: "Correct. You included open covers and finite subcovers.",
        review_rating: "Good",
        evidence_score: 0.82,
        strengths: ["Correct formal definition"],
        weaknesses: [],
        misconceptions: [],
        topic_evidence: [{
          topic_id: "answer_pipeline_compactness",
          evidence_strength: 0.82,
          coverage_signal: 0.35
        }]
      }]
    });

    // [UI -> Server] Read draft review and confirm final results are not ready.
    const draft = await getReviewDraft(quiz.quiz_id);
    expect(draft.status).toBe("review_drafted");
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.review_rating).toBe("Good");
    const notReadyResults = await getQuizResults(quiz.quiz_id);
    expect(notReadyResults.results_ready).toBe(false);

    // [Server] No finalization means no immutable grades and no learner-model update.
    const grades = await getResponseGrades(submitted.review_payload[0]!.response_id);
    expect(grades.grades).toEqual([]);
    const profile = await getTopicProfile("answer_pipeline_compactness");
    expect(profile.knowledge_score).toBe(0);
    expect(profile.coverage_score).toBe(0);
  });

  it("models mixed quiz item outcomes and omits never-shown items from the review payload", async () => {
    // [User -> AI] "Run a mixed outcome quiz."
    // [AI -> Server] Create a five-item quiz.
    await createTopic({ slug: "answer_pipeline_mixed", title: "Answer Pipeline Mixed", tags: ["topology"] });
    const questions = await Promise.all([
      createQuestion({
        slug: "mixed_answered",
        topic_ids: ["answer_pipeline_mixed"],
        question_tags: ["definition"],
        modality: "free_response",
        prompt: "Define an open cover."
      }),
      createQuestion({
        slug: "mixed_skipped",
        topic_ids: ["answer_pipeline_mixed"],
        question_tags: ["example"],
        modality: "free_response",
        prompt: "Give an example of an open cover."
      }),
      createQuestion({
        slug: "mixed_no_answer",
        topic_ids: ["answer_pipeline_mixed"],
        question_tags: ["diagnostic"],
        modality: "free_response",
        prompt: "State why compactness asks for finite subcovers."
      }),
      createQuestion({
        slug: "mixed_timed_out",
        topic_ids: ["answer_pipeline_mixed"],
        question_tags: ["timed"],
        modality: "free_response",
        prompt: "Explain finite subcovers under time pressure."
      }),
      createQuestion({
        slug: "mixed_never_shown",
        topic_ids: ["answer_pipeline_mixed"],
        question_tags: ["unused"],
        modality: "free_response",
        prompt: "This item should not appear in the review payload."
      })
    ]);
    const quiz = await createQuiz({
      topic_ids: ["answer_pipeline_mixed"],
      question_refs: questions.map((question, index) => ({ question_id: question.id, order: index + 1 }))
    });
    const items = await getQuizItems(quiz.quiz_id);

    // [User -> AI -> Server] Save mixed presented outcomes.
    await saveResponseDraft(items.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "A collection of open sets covering the space."
    });
    await saveResponseDraft(items.items[1]!.quiz_item_id, {
      outcome: "skipped",
      answer_text: null
    });
    await saveResponseDraft(items.items[2]!.quiz_item_id, {
      outcome: "no_answer",
      answer_text: null
    });
    await saveResponseDraft(items.items[3]!.quiz_item_id, {
      outcome: "timed_out",
      answer_text: null
    });

    // [AI -> Server] Submit all presented outcomes; never-shown item is omitted.
    const submitted = await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "mixed-submit",
      submitted_from: "test"
    });
    expect(submitted.review_payload.map((item) => item.response.outcome)).toEqual([
      "answered",
      "skipped",
      "no_answer",
      "timed_out"
    ]);
    expect(submitted.review_payload.map((item) => item.question.prompt)).not.toContain("This item should not appear in the review payload.");
  });

  it("models safe learner edits on staged AI review feedback without finalizing", async () => {
    // [User -> AI] "Quiz me, then let me inspect the review draft."
    // [AI -> Server] Create a quiz, save answer, submit responses, and stage AI review.
    await createTopic({ slug: "answer_pipeline_review_edits", title: "Answer Pipeline Review Edits", tags: ["topology"] });
    const question = await createQuestion({
      slug: "review_edits_open_cover",
      topic_ids: ["answer_pipeline_review_edits"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "Define an open cover."
    });
    const quiz = await createQuiz({
      topic_ids: ["answer_pipeline_review_edits"],
      question_refs: [{ question_id: question.id, order: 1 }]
    });
    const items = await getQuizItems(quiz.quiz_id);
    const response = await saveResponseDraft(items.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "A collection of open sets that covers the space."
    });
    await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "review-edits-submit",
      submitted_from: "test"
    });
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "review-edits-draft",
      summary: { overview: "Mostly correct." },
      items: [{
        response_id: response.response_id,
        outcome: "answered",
        overall_feedback: "Mostly correct definition.",
        review_rating: "Good",
        evidence_score: 0.74,
        strengths: ["Recognizes cover by open sets"],
        weaknesses: [],
        misconceptions: [],
        topic_evidence: [{
          topic_id: "answer_pipeline_review_edits",
          evidence_strength: 0.74,
          coverage_signal: 0.25
        }]
      }]
    });
    const draft = await getReviewDraft(quiz.quiz_id);
    const draftItem = draft.items[0];
    if (!draftItem) throw new Error("review draft item missing");

    // [Learner -> UI] Add a note and dispute.
    // [UI -> Server] Save only safe mutable review fields.
    const patched = await patchReviewDraft(quiz.quiz_id, {
      items: [{
        review_draft_item_id: draftItem.review_draft_item_id,
        overall_feedback: "Feedback text edited for clarity.",
        learner_note: "I want this checked again.",
        dispute_reason: "The rating seems too generous.",
        excluded: false
      }]
    });
    expect(patched.needs_ai_re_review).toBe(true);

    const afterPatch = await getReviewDraft(quiz.quiz_id);
    expect(afterPatch.items[0]?.overall_feedback).toBe("Feedback text edited for clarity.");
    expect(afterPatch.items[0]?.learner_note).toBe("I want this checked again.");
    expect(afterPatch.items[0]?.needs_ai_re_review).toBe(true);

    // [Server] Review edits are staged only. No finalization, grades, or learner-model updates yet.
    const grades = await getResponseGrades(response.response_id);
    expect(grades.grades).toEqual([]);
    const profile = await getTopicProfile("answer_pipeline_review_edits");
    expect(profile.knowledge_score).toBe(0);
    expect(profile.coverage_score).toBe(0);
  });

  it("finalizes a valid review draft into immutable grades, deterministic profile updates, due state, and finalized results", async () => {
    // [User -> AI -> Server] Submit a quiz response and stage valid AI review evidence.
    const { quiz, response } = await createSubmittedSingleItemQuiz({
      topicSlug: "finalize_projection_topic",
      questionSlug: "finalize_projection_question",
      prompt: "State the definition used for this projection test.",
      answerText: "Every open cover has a finite subcover.",
      submitKey: "finalize-projection-submit"
    });
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "finalize-projection-draft",
      summary: {
        overview: "Projection-ready review.",
        strengths: ["Precise definition"],
        weaknesses: ["Needs examples"],
        improvement_targets: ["examples"]
      },
      items: [{
        response_id: response.response_id,
        outcome: "answered",
        overall_feedback: "Correct definition.",
        review_rating: "Good",
        evidence_score: 0.5,
        strengths: ["Precise definition"],
        weaknesses: ["Needs examples"],
        misconceptions: ["Overfocuses on memorized definition"],
        topic_evidence: [{
          topic_id: "finalize_projection_topic",
          evidence_strength: 0.5,
          coverage_signal: 0.25
        }]
      }]
    });

    // [UI -> Server] Finalize the review draft.
    const finalized = await finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-projection-finalize" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.grade_results).toHaveLength(1);
    expect(finalized.learner_model_updates).toHaveLength(1);

    // [UI -> Server] Same idempotency key returns the same finalized response.
    const finalizedAgain = await finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-projection-finalize" });
    expect(finalizedAgain).toEqual(finalized);

    // [UI -> Server] Different finalization key after success conflicts.
    await expect(finalizeReviewDraft(quiz.quiz_id, { idempotency_key: "finalize-projection-finalize-again" })).rejects.toThrow(/already finalized/i);

    // [AI/UI -> Server] Finalized result payload exposes ratings, items, and topic deltas.
    const results = await getQuizResults(quiz.quiz_id);
    expect(results.results_ready).toBe(true);
    if (!("rating_counts" in results)) throw new Error("quiz results were not finalized");
    expect((results as { overview?: unknown }).overview).toBe("Projection-ready review.");
    expect(results.rating_counts.Good).toBe(1);
    expect(results.items[0]?.feedback).toBe("Correct definition.");
    expect(results.topic_deltas[0]?.before_knowledge).toBe(0);
    expect(results.topic_deltas[0]?.after_knowledge).toBeCloseTo(0.15);
    expect(results.topic_deltas[0]?.before_coverage).toBe(0);
    expect(results.topic_deltas[0]?.after_coverage).toBeCloseTo(0.03);

    // [AI/UI -> Server] Topic profile reflects finalized evidence only.
    const profile = await getTopicProfile("finalize_projection_topic");
    expect(profile.knowledge_score).toBeCloseTo(0.15);
    expect(profile.coverage_score).toBeCloseTo(0.03);
    expect(profile.strengths).toContain("Precise definition");
    expect(profile.weaknesses).toContain("Needs examples");
    expect(profile.active_misconceptions).toContain("Overfocuses on memorized definition");
    expect(profile.evidence_count).toBe(1);
    expect(profile.last_reviewed_at).toBeInstanceOf(Date);

    // [AI -> Server] Review state exposes due scheduling after finalization.
    const dueItems = await reviewItems({ topicId: "finalize_projection_topic", limit: 10 });
    expect(dueItems.items).toHaveLength(1);
    expect(dueItems.items[0]?.question_id).toBe("finalize_projection_question");
    expect(dueItems.items[0]?.last_rating).toBe("Good");
    expect(dueItems.items[0]?.due_at).toBeInstanceOf(Date);

    const updates = await learnerModelUpdateList({ status: "applied", limit: 20 });
    expect(updates.updates.some((update) => update.quiz_id === quiz.quiz_id)).toBe(true);

    const grades = await getResponseGrades(response.response_id);
    expect(grades.grades).toHaveLength(1);
    expect(grades.grades[0]?.review_rating).toBe("Good");

    // [Server] Finalized records are immutable through public workflow calls.
    const items = await getQuizItems(quiz.quiz_id);
    await expect(saveResponseDraft(items.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "Trying to edit finalized response."
    })).rejects.toThrow(/Cannot edit responses/);
    const draft = await getReviewDraft(quiz.quiz_id);
    await expect(patchReviewDraft(quiz.quiz_id, {
      items: [{
        review_draft_item_id: draft.items[0]!.review_draft_item_id,
        overall_feedback: "Trying to patch finalized review."
      }]
    })).rejects.toThrow(/finalized/);
    await expect(createReviewDraft(quiz.quiz_id, {
      idempotency_key: "finalize-projection-recreate",
      summary: {},
      items: [{
        response_id: response.response_id,
        outcome: "answered",
        overall_feedback: "Trying to recreate finalized review.",
        review_rating: "Good",
        evidence_score: 0.5,
        topic_evidence: [{ topic_id: "finalize_projection_topic", evidence_strength: 0.5, coverage_signal: 0.25 }]
      }]
    })).rejects.toThrow(/finalized/);
  });

  it("rejects invalid review draft payloads before they can become canonical evidence", async () => {
    // [AI -> Server] Prepare two submitted quizzes to test response ownership and payload invariants.
    const first = await createSubmittedSingleItemQuiz({
      topicSlug: "invalid_draft_first",
      questionSlug: "invalid_draft_first_question",
      submitKey: "invalid-draft-first-submit"
    });
    const second = await createSubmittedSingleItemQuiz({
      topicSlug: "invalid_draft_second",
      questionSlug: "invalid_draft_second_question",
      submitKey: "invalid-draft-second-submit"
    });

    await expect(createReviewDraft(first.quiz.quiz_id, {
      idempotency_key: "invalid-draft-cross-quiz",
      summary: {},
      items: [{
        response_id: second.response.response_id,
        outcome: "answered",
        overall_feedback: "Cross-quiz response should not be accepted.",
        review_rating: "Good",
        evidence_score: 0.7,
        topic_evidence: [{ topic_id: "invalid_draft_first", evidence_strength: 0.7, coverage_signal: 0.2 }]
      }]
    })).rejects.toThrow(/does not belong/);

    await expect(createReviewDraft(first.quiz.quiz_id, {
      idempotency_key: "invalid-draft-duplicate",
      summary: {},
      items: [
        {
          response_id: first.response.response_id,
          outcome: "answered",
          overall_feedback: "First copy.",
          review_rating: "Good",
          evidence_score: 0.7,
          topic_evidence: [{ topic_id: "invalid_draft_first", evidence_strength: 0.7, coverage_signal: 0.2 }]
        },
        {
          response_id: first.response.response_id,
          outcome: "answered",
          overall_feedback: "Duplicate copy.",
          review_rating: "Good",
          evidence_score: 0.7,
          topic_evidence: [{ topic_id: "invalid_draft_first", evidence_strength: 0.7, coverage_signal: 0.2 }]
        }
      ]
    })).rejects.toThrow(/duplicate/);

    await expect(createReviewDraft(first.quiz.quiz_id, {
      idempotency_key: "invalid-draft-outcome",
      summary: {},
      items: [{
        response_id: first.response.response_id,
        outcome: "skipped",
        overall_feedback: "Outcome mismatch should not be accepted.",
        review_rating: "Good",
        evidence_score: 0.7,
        topic_evidence: [{ topic_id: "invalid_draft_first", evidence_strength: 0.7, coverage_signal: 0.2 }]
      }]
    })).rejects.toThrow(/outcome/);

    await expect(createReviewDraft(first.quiz.quiz_id, {
      idempotency_key: "invalid-draft-missing-rating",
      summary: {},
      items: [{
        response_id: first.response.response_id,
        outcome: "answered",
        overall_feedback: "Missing rating should not be accepted.",
        evidence_score: 0.7,
        topic_evidence: [{ topic_id: "invalid_draft_first", evidence_strength: 0.7, coverage_signal: 0.2 }]
      }]
    })).rejects.toThrow(/review rating/);

    await expect(createReviewDraft(first.quiz.quiz_id, {
      idempotency_key: "invalid-draft-missing-evidence",
      summary: {},
      items: [{
        response_id: first.response.response_id,
        outcome: "answered",
        overall_feedback: "Missing evidence should not be accepted.",
        review_rating: "Good",
        evidence_score: 0.7,
        topic_evidence: []
      }]
    })).rejects.toThrow(/topic evidence/);
  });

  it("replaces review drafts without leaving omitted responses in review-drafted state", async () => {
    // [AI -> Server] Create a two-item submitted quiz.
    await createTopic({ slug: "replace_review_draft_topic", title: "replace review draft topic", tags: ["topology"] });
    const firstQuestion = await createQuestion({
      slug: "replace_review_draft_first_question",
      topic_ids: ["replace_review_draft_topic"],
      question_tags: ["definition"],
      modality: "free_response",
      prompt: "Define the first concept."
    });
    const secondQuestion = await createQuestion({
      slug: "replace_review_draft_second_question",
      topic_ids: ["replace_review_draft_topic"],
      question_tags: ["example"],
      modality: "free_response",
      prompt: "Give an example of the concept."
    });
    const quiz = await createQuiz({
      topic_ids: ["replace_review_draft_topic"],
      question_refs: [
        { question_id: firstQuestion.id, order: 1 },
        { question_id: secondQuestion.id, order: 2 }
      ]
    });
    const items = await getQuizItems(quiz.quiz_id);
    const firstResponse = await saveResponseDraft(items.items[0]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "First answer."
    });
    const secondResponse = await saveResponseDraft(items.items[1]!.quiz_item_id, {
      outcome: "answered",
      answer_text: "Second answer."
    });
    await submitQuizResponses(quiz.quiz_id, {
      idempotency_key: "replace-review-draft-submit",
      submitted_from: "test"
    });

    // [AI -> Server] Store an initial subset review draft for the first response.
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "replace-review-draft-first",
      summary: {},
      items: [{
        response_id: firstResponse.response_id,
        outcome: "answered",
        overall_feedback: "First response reviewed.",
        review_rating: "Good",
        evidence_score: 0.6,
        topic_evidence: [{ topic_id: "replace_review_draft_topic", evidence_strength: 0.6, coverage_signal: 0.2 }]
      }]
    });
    expect((await getResponse(firstResponse.response_id)).response.response_state).toBe("review_drafted");

    // [AI -> Server] Replace the draft with a different subset.
    await createReviewDraft(quiz.quiz_id, {
      idempotency_key: "replace-review-draft-second",
      summary: {},
      items: [{
        response_id: secondResponse.response_id,
        outcome: "answered",
        overall_feedback: "Second response reviewed.",
        review_rating: "Hard",
        evidence_score: 0.5,
        topic_evidence: [{ topic_id: "replace_review_draft_topic", evidence_strength: 0.5, coverage_signal: 0.2 }]
      }]
    });

    expect((await getResponse(firstResponse.response_id)).response.response_state).toBe("submitted");
    expect((await getResponse(secondResponse.response_id)).response.response_state).toBe("review_drafted");
  });

  it("blocks empty finalization and handles excluded items without learner-model updates", async () => {
    // [AI -> Server] Empty review drafts can be staged but cannot be finalized.
    const empty = await createSubmittedSingleItemQuiz({
      topicSlug: "empty_finalization_topic",
      questionSlug: "empty_finalization_question",
      submitKey: "empty-finalization-submit"
    });
    await createReviewDraft(empty.quiz.quiz_id, {
      idempotency_key: "empty-finalization-draft",
      summary: {},
      items: []
    });
    await expect(finalizeReviewDraft(empty.quiz.quiz_id, { idempotency_key: "empty-finalization-finalize" })).rejects.toThrow(/empty review draft/);

    // [AI -> Server] Excluded items may omit rating/evidence and may carry a re-review flag.
    const excluded = await createSubmittedSingleItemQuiz({
      topicSlug: "excluded_finalization_topic",
      questionSlug: "excluded_finalization_question",
      submitKey: "excluded-finalization-submit"
    });
    await createReviewDraft(excluded.quiz.quiz_id, {
      idempotency_key: "excluded-finalization-draft",
      summary: {},
      items: [{
        response_id: excluded.response.response_id,
        outcome: "answered",
        overall_feedback: "Question was invalid, so exclude it.",
        excluded: true,
        needs_ai_re_review: true,
        topic_evidence: []
      }]
    });
    const finalized = await finalizeReviewDraft(excluded.quiz.quiz_id, { idempotency_key: "excluded-finalization-finalize" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.grade_results).toHaveLength(1);
    expect(finalized.grade_results[0]?.excluded).toBe(true);
    expect(finalized.learner_model_updates).toEqual([]);

    const profile = await getTopicProfile("excluded_finalization_topic");
    expect(profile.knowledge_score).toBe(0);
    expect(profile.coverage_score).toBe(0);
    expect(profile.evidence_count).toBe(0);

    const dueItems = await reviewItems({ topicId: "excluded_finalization_topic", limit: 10 });
    expect(dueItems.items).toEqual([]);
  });

  it("counts non-answer outcomes as evidence when AI supplies rating and topic evidence", async () => {
    // [User -> AI] Learner times out on a question.
    // [AI -> Server] AI review can still provide evidence for the missed item.
    const timedOut = await createSubmittedSingleItemQuiz({
      topicSlug: "timed_out_counts_topic",
      questionSlug: "timed_out_counts_question",
      outcome: "timed_out",
      answerText: null,
      submitKey: "timed-out-counts-submit"
    });
    await createReviewDraft(timedOut.quiz.quiz_id, {
      idempotency_key: "timed-out-counts-draft",
      summary: {},
      items: [{
        response_id: timedOut.response.response_id,
        outcome: "timed_out",
        overall_feedback: "Timed out before producing the definition.",
        review_rating: "Again",
        evidence_score: 0.6,
        weaknesses: ["Could not produce answer under time pressure"],
        topic_evidence: [{ topic_id: "timed_out_counts_topic", evidence_strength: 0.6, coverage_signal: 0.2 }]
      }]
    });
    const finalized = await finalizeReviewDraft(timedOut.quiz.quiz_id, { idempotency_key: "timed-out-counts-finalize" });
    expect(finalized.learner_model_updates).toHaveLength(1);

    const profile = await getTopicProfile("timed_out_counts_topic");
    expect(profile.knowledge_score).toBeGreaterThan(0);
    expect(profile.weaknesses).toContain("Could not produce answer under time pressure");
  });

  it("filters activity by topic scope for knowledge-model inspection", async () => {
    // [AI -> Server] Create activity for two unrelated topic scopes.
    const target = await createSubmittedSingleItemQuiz({
      topicSlug: "activity_filter_target",
      questionSlug: "activity_filter_target_question",
      submitKey: "activity-filter-target-submit"
    });
    const other = await createSubmittedSingleItemQuiz({
      topicSlug: "activity_filter_other",
      questionSlug: "activity_filter_other_question",
      submitKey: "activity-filter-other-submit"
    });

    // [Knowledge Modeler -> Server] Activity reads should honor topic_id.
    const targetActivity = await activity({ topicId: "activity_filter_target", limit: 50 });
    expect(targetActivity.items.some((item) => item.entity_id === target.quiz.quiz_id)).toBe(true);
    expect(targetActivity.items.some((item) => item.entity_id === other.quiz.quiz_id)).toBe(false);
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
