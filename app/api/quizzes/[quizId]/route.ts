import { getParams, route, type RouteContext } from "@/src/server/http";
import { getQuiz } from "@/src/server/services";

export async function GET(_request: Request, context: RouteContext<{ quizId: string }>) {
  return route(async () => getQuiz((await getParams(context)).quizId));
}
