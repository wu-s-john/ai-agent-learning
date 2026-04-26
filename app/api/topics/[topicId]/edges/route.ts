import { getParams, parseSearchParams, route, type RouteContext } from "@/src/server/http";
import { getTopicEdges } from "@/src/server/services";

export async function GET(request: Request, context: RouteContext<{ topicId: string }>) {
  return route(async () => {
    const params = parseSearchParams(request);
    const edgeTypes = params.get("edge_types")?.split(",").filter(Boolean);
    return getTopicEdges((await getParams(context)).topicId, { edgeTypes, direction: params.get("direction") ?? undefined });
  });
}
