// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyDatabaseError } from "@/lib/server/db";
import { apiError } from "@/lib/server/http";

describe("database error API classification", () => {
  it("does not label a CHECK violation as database connectivity failure", async () => {
    const response = apiError(classifyDatabaseError({ code: "23514" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Database rejected inconsistent data",
      code: "DATABASE_CONSTRAINT_VIOLATION",
    });
  });

  it("keeps a refused connection classified as unavailable", async () => {
    const response = apiError(classifyDatabaseError({ code: "ECONNREFUSED" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });
});
