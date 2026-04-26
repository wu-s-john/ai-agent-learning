import { getParams, route, type RouteContext } from "@/src/server/http";
import { getQuizItems } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => getQuizItems((await getParams(context)).quizId));
}
