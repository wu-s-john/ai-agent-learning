import { getParams, route, type RouteContext } from "@/src/server/http";
import { deleteTopicEdge } from "@/src/server/services";

export async function DELETE(_request: Request, context: RouteContext<{ edgeId: string }>) {
  return route(async () => deleteTopicEdge((await getParams(context)).edgeId));
}
