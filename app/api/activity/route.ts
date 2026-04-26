import { parseSearchParams, route } from "@/src/server/http";
import { activity } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return activity({ topicId: params.get("topic_id"), limit: Number(params.get("limit") ?? 50) });
  });
}
