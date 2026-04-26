import { parseJson, parseSearchParams, route } from "@/src/server/http";
import { topicProposalSchema } from "@/src/server/schemas";
import { createTopicProposal, listTopicProposals } from "@/src/server/services";

export async function GET(request: Request) {
  return route(async () => listTopicProposals(parseSearchParams(request).get("status")));
}

export async function POST(request: Request) {
  return route(async () => createTopicProposal(await parseJson(request, topicProposalSchema)));
}
