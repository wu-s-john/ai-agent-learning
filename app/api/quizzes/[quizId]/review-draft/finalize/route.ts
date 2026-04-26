import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { finalizeReviewSchema } from "@/src/server/schemas";
import { finalizeReviewDraft } from "@/src/server/services";

export async function POST(request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => finalizeReviewDraft((await getParams(context)).quizId, await parseJson(request, finalizeReviewSchema)));
}
