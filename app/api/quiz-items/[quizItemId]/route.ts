import { getParams, route, type RouteContext } from "@/src/server/http";
import { getQuizItem } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ quizItemId: string }>) {
  return route(async () => getQuizItem((await getParams(context)).quizItemId));
}
