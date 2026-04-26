import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { feedbackSchema } from "@/src/server/schemas";
import { createQuizFeedback } from "@/src/server/services";

export async function POST(request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => createQuizFeedback((await getParams(context)).quizId, await parseJson(request, feedbackSchema)));
}
