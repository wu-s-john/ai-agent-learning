import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "./errors";

export type RouteContext<TParams extends Record<string, string> = Record<string, string>> = {
  params: Promise<TParams> | TParams;
};

export async function route<T>(handler: () => Promise<T>) {
  try {
    const data = await handler();
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: { message: error.message, details: error.details ?? null } },
        { status: error.status }
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: { message: "Invalid request", details: error.flatten() } },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => ({}));
  return schema.parse(body);
}

export function parseSearchParams(request: Request) {
  return new URL(request.url).searchParams;
}

export async function getParams<T extends Record<string, string>>(context: RouteContext<T>): Promise<T> {
  return await context.params;
}
