import { describe, expect, it } from "vitest";
import { createQuestionSchema, responseDraftSchema } from "@/src/server/schemas";
import { slugify } from "@/src/server/utils";

describe("MVP backend invariants", () => {
  it("slugifies readable ids", () => {
    expect(slugify("Open Cover Compactness!")).toBe("open_cover_compactness");
  });

  it("accepts question tags and rejects rubric-free assumptions by omission", () => {
    const parsed = createQuestionSchema.parse({
      topic_ids: ["compactness"],
      question_tags: ["definition", "open-cover"],
      modality: "free_response",
      prompt: "State compactness using open covers."
    });
    expect(parsed.question_tags).toEqual(["definition", "open-cover"]);
    expect("rubric" in parsed).toBe(false);
  });

  it("supports no_answer as the shown-but-unanswered outcome", () => {
    const parsed = responseDraftSchema.parse({
      outcome: "no_answer",
      answer_text: null,
      image_refs: [],
      submitted_from: "chat"
    });
    expect(parsed.outcome).toBe("no_answer");
  });
});
