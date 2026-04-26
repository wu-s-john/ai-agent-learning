import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { patchTopicSchema } from "@/src/server/schemas";
import { getTopic, patchTopic } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ topicId: string }>) {
  return route(async () => getTopic((await getParams(context)).topicId));
}

export async function PATCH(request: Request, context: RouteContext<{ topicId: string }>) {
  return route(async () => patchTopic((await getParams(context)).topicId, await parseJson(request, patchTopicSchema)));
}
