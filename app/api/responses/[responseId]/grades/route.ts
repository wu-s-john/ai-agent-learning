import { getParams, route, type RouteContext } from "@/src/server/http";
import { getResponseGrades } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ responseId: string }>) {
  return route(async () => getResponseGrades((await getParams(context)).responseId));
}
