import { route } from "@/src/server/http";
import { progressOverview } from "@/src/server/services";

export async function GET() {
  return route(async () => progressOverview());
}
