import { getParams, route, type RouteContext } from "@/src/server/http";
import { getQuizResults } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => getQuizResults((await getParams(context)).quizId));
}
