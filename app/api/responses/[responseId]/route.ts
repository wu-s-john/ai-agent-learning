import { getParams, route, type RouteContext } from "@/src/server/http";
import { getResponse } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ responseId: string }>) {
  return route(async () => getResponse((await getParams(context)).responseId));
}
