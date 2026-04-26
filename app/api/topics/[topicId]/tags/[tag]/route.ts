import { getParams, route, type RouteContext } from "@/src/server/http";
import { deleteTopicTag } from "@/src/server/services";

export async function DELETE(_request: Request, context: RouteContext<{ topicId: string; tag: string }>) {
  return route(async () => {
    const params = await getParams(context);
    return deleteTopicTag(params.topicId, params.tag);
  });
}
