import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { createReviewDraftSchema, patchReviewDraftSchema } from "@/src/server/schemas";
import { createReviewDraft, getReviewDraft, patchReviewDraft } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => getReviewDraft((await getParams(context)).quizId));
}

export async function POST(request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => createReviewDraft((await getParams(context)).quizId, await parseJson(request, createReviewDraftSchema)));
}

export async function PATCH(request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => patchReviewDraft((await getParams(context)).quizId, await parseJson(request, patchReviewDraftSchema)));
}
