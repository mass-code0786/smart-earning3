// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const loadEnvConfig = vi.hoisted(() => vi.fn());
vi.mock("@next/env", () => ({ loadEnvConfig }));

import {
  loadAuthoritativeEnvironment,
  redactDatabaseIdentity,
  resetEnvironmentLoaderForTests,
} from "@/lib/server/production-environment";

const original = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };

afterEach(() => {
  Object.assign(process.env, original);
  if (original.NODE_ENV === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  if (original.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  resetEnvironmentLoaderForTests();
  vi.clearAllMocks();
});

describe("authoritative production environment", () => {
  it("uses the production process DATABASE_URL without loading .env", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:secret@db.internal:5434/prod",
    });
    expect(loadAuthoritativeEnvironment()).toMatchObject({
      source: "process",
      databaseIdentity: {
        host: "db.internal", port: "5434", database: "prod", user: "app",
      },
    });
    expect(loadEnvConfig).not.toHaveBeenCalled();
  });

  it("fails closed instead of falling back to local .env in production", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    Reflect.deleteProperty(process.env, "DATABASE_URL");
    expect(() => loadAuthoritativeEnvironment()).toThrow("DATABASE_URL must be supplied");
    expect(loadEnvConfig).not.toHaveBeenCalled();
  });

  it("never includes the password in redacted identity", () => {
    const output = JSON.stringify(redactDatabaseIdentity(
      "postgresql://app:super-secret@db.internal/prod",
    ));
    expect(output).not.toContain("super-secret");
  });
});
