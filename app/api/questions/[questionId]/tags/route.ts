import { z } from "zod";
import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { addQuestionTags } from "@/src/server/services";

const schema = z.object({ tags: z.array(z.string()).default([]) });

export async function POST(request: Request, context: RouteContext<{ questionId: string }>) {
  return route(async () => addQuestionTags((await getParams(context)).questionId, (await parseJson(request, schema)).tags));
}
