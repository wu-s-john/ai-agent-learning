import { z } from "zod";
import { parseJson, parseSearchParams, route } from "@/src/server/http";
import { createReference, searchReferences } from "@/src/server/services";

const schema = z.object({
  slug: z.string().optional(),
  title: z.string(),
  path_or_url: z.string(),
  chunks: z.array(z.object({ heading: z.string().optional(), text: z.string(), snippet: z.string().optional() })).default([])
});

export async function GET(request: Request) {
  return route(async () => {
    const params = parseSearchParams(request);
    return searchReferences(params.get("q"), Number(params.get("limit") ?? 10));
  });
}

export async function POST(request: Request) {
  return route(async () => createReference(await parseJson(request, schema)));
}
