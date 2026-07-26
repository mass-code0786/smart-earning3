import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAuthConfig, ServerConfigError } from "./config";
import { DatabaseConnectionError } from "./db";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigin = new URL(getAuthConfig().APP_ORIGIN).origin;
  let requestOrigin: string | undefined;
  try {
    requestOrigin = origin ? new URL(origin).origin : undefined;
  } catch {
    throw new ApiError(403, "Origin is not allowed", "INVALID_ORIGIN");
  }
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    throw new ApiError(403, "Origin is not allowed", "INVALID_ORIGIN");
  }
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    console.warn("[auth request validation]", error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })));
    return NextResponse.json(
      { error: "The login request was not accepted", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }
  if (error instanceof ServerConfigError) {
    console.error(`[configuration] ${error.message}`);
    return NextResponse.json(
      { error: "Server configuration incomplete", code: "SERVER_CONFIG_INCOMPLETE" },
      { status: 503 },
    );
  }
  if (error instanceof DatabaseConnectionError) {
    console.error(`[database:${error.databaseCode}] ${error.message}`);
    return NextResponse.json(
      { error: "Database service unavailable", code: "DATABASE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  console.error("[api error]", error);
  return NextResponse.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
