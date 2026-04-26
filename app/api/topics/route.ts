import { route, parseJson, parseSearchParams } from "@/src/server/http";
import { createTopicSchema } from "@/src/server/schemas";
import { createTopic, searchTopics } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return searchTopics(params.get("q"), Number(params.get("limit") ?? 10));
  });
}

export async function POST(request: Request) {
  return route(async () => createTopic(await parseJson(request, createTopicSchema)));
}
