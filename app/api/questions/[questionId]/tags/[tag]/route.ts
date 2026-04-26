import { getParams, route, type RouteContext } from "@/src/server/http";
import { deleteQuestionTag } from "@/src/server/services";

export async function DELETE(_request: Request, context: RouteContext<{ questionId: string; tag: string }>) {
  return route(async () => {
    const params = await getParams(context);
    return deleteQuestionTag(params.questionId, params.tag);
  });
}
