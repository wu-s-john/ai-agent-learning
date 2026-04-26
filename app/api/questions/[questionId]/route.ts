import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { patchQuestionSchema } from "@/src/server/schemas";
import { getQuestion, patchQuestion } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ questionId: string }>) {
  return route(async () => getQuestion((await getParams(context)).questionId));
}

export async function PATCH(request: Request, context: RouteContext<{ questionId: string }>) {
  return route(async () => patchQuestion((await getParams(context)).questionId, await parseJson(request, patchQuestionSchema)));
}
