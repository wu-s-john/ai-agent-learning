import { getParams, route, type RouteContext } from "@/src/server/http";
import { getTopicProfile } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ topicId: string }>) {
  return route(async () => getTopicProfile((await getParams(context)).topicId));
}
