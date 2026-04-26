import { parseJson, route } from "@/src/server/http";
import { learnerSnapshotSchema } from "@/src/server/schemas";
import { learnerSnapshot } from "@/src/server/services";

export async function POST(request: Request) {
  return route(async () => learnerSnapshot(await parseJson(request, learnerSnapshotSchema)));
}
