import { z } from "zod";
import { parseJson, route } from "@/src/server/http";
import { searchQuestions } from "@/src/server/services";

const schema = z.object({
  topic_ids: z.array(z.string()).default([]),
  target_topic_ids: z.array(z.string()).default([]),
  preferred_tags: z.array(z.string()).default([]),
  mode: z.string().default("mixed"),
  limit: z.number().int().positive().max(100).default(30),
  include_due: z.boolean().default(true),
  include_new: z.boolean().default(true),
  due_bias: z.number().min(0).max(1).default(0.3)
});

export async function POST(request: Request) {
  return route(async () => {
    const body = await parseJson(request, schema);
    return searchQuestions(null, { topicId: body.target_topic_ids[0] ?? body.topic_ids[0], tag: body.preferred_tags[0], limit: body.limit });
  });
}
