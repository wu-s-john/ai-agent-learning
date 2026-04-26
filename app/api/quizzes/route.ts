import { parseJson, parseSearchParams, route } from "@/src/server/http";
import { createQuizSchema } from "@/src/server/schemas";
import { createQuiz, listQuizzes } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return listQuizzes({ topicId: params.get("topic_id"), limit: Number(params.get("limit") ?? 20) });
  });
}

export async function POST(request: Request) {
  return route(async () => createQuiz(await parseJson(request, createQuizSchema)));
}
