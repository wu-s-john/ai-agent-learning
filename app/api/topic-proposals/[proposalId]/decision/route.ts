import { z } from "zod";
import { getParams, parseJson, route, type RouteContext } from "@/src/server/http";
import { decideTopicProposal } from "@/src/server/services";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().optional()
});

export async function POST(request: Request, context: RouteContext<{ proposalId: string }>) {
  return route(async () => decideTopicProposal((await getParams(context)).proposalId, await parseJson(request, schema)));
}
