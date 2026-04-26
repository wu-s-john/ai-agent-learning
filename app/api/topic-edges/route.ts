import { z } from "zod";
import { parseJson, route } from "@/src/server/http";
import { edgeTypeSchema } from "@/src/server/schemas";
import { createTopicEdge } from "@/src/server/services";

const schema = z.object({
  from_topic_id: z.string(),
  to_topic_id: z.string(),
  edge_type: edgeTypeSchema
});

export async function POST(request: Request) {
  return route(async () => createTopicEdge(await parseJson(request, schema)));
}
