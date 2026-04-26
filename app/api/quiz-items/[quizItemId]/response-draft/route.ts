import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { responseDraftSchema } from "@/src/server/schemas";
import { saveResponseDraft } from "@/src/server/services";

export async function POST(request: Request, context: RouteContext<{ quizItemId: string }>) {
  return route(async () => saveResponseDraft((await getParams(context)).quizItemId, await parseJson(request, responseDraftSchema)));
}
