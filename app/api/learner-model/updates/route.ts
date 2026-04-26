import { parseSearchParams, route } from "@/src/server/http";
import { learnerModelUpdateList } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return learnerModelUpdateList({ status: params.get("status"), limit: Number(params.get("limit") ?? 20) });
  });
}
