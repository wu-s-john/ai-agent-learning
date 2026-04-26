import { z } from "zod";
import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { addTopicTags } from "@/src/server/services";

const schema = z.object({ tags: z.array(z.string()).default([]) });

export async function POST(request: Request, context: RouteContext<{ topicId: string }>) {
  return route(async () => addTopicTags((await getParams(context)).topicId, (await parseJson(request, schema)).tags));
}
