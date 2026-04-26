import { parseJson, parseSearchParams, route } from "@/src/server/http";
import { createQuestionSchema } from "@/src/server/schemas";
import { createQuestion, searchQuestions } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return searchQuestions(params.get("q"), {
      topicId: params.get("topic_id"),
      status: params.get("status"),
      modality: params.get("modality"),
      tag: params.get("tag"),
      difficultyTarget: params.has("difficulty_target") ? Number(params.get("difficulty_target")) : null,
      includeDue: params.get("include_due") !== "false",
      limit: Number(params.get("limit") ?? 20)
    });
  });
}

export async function POST(request: Request) {
  return route(async () => createQuestion(await parseJson(request, createQuestionSchema)));
}
