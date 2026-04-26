export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFound(message = "Not found"): never {
  throw new ApiError(404, message);
}

export function conflict(message: string, details?: unknown): never {
  throw new ApiError(409, message, details);
}

export function badRequest(message: string, details?: unknown): never {
  throw new ApiError(400, message, details);
}

export function assertFound<T>(value: T | undefined | null, message = "Not found"): T {
  if (value == null) notFound(message);
  return value;
}
