import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { submitResponsesSchema } from "@/src/server/schemas";
import { submitQuizResponses } from "@/src/server/services";

export async function POST(request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => submitQuizResponses((await getParams(context)).quizId, await parseJson(request, submitResponsesSchema)));
}
