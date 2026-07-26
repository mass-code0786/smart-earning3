// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyDatabaseError,
  databaseSslConfig,
  DatabaseConnectionError,
} from "@/lib/server/db";

const local = "postgresql://postgres:postgres@localhost:5433/smartearning";
const hosted = "postgresql://app:secret@db.example.com:5432/smartearning";

describe("PostgreSQL SSL selection", () => {
  it("disables SSL for localhost when no mode is explicit", () => {
    expect(databaseSslConfig(local, undefined)).toBe(false);
    expect(databaseSslConfig("postgresql://postgres:postgres@127.0.0.1:5433/db", undefined)).toBe(false);
  });

  it("honors explicit disable and require modes", () => {
    expect(databaseSslConfig(hosted, "disable")).toBe(false);
    expect(databaseSslConfig(hosted, "require")).toEqual({ rejectUnauthorized: true });
  });

  it("requires explicit CA material for verify-full", () => {
    expect(() => databaseSslConfig(hosted, "verify-full", "")).toThrowError(
      expect.objectContaining({ databaseCode: "CERTIFICATE_VERIFICATION_FAILED" }),
    );
    expect(databaseSslConfig(hosted, "verify-full", "test-ca")).toEqual({
      rejectUnauthorized: true,
      ca: "test-ca",
    });
  });

  it("rejects an invalid SSL mode", () => {
    expect(() => databaseSslConfig(hosted, "prefer")).toThrowError(
      new DatabaseConnectionError(
        "DATABASE_ERROR",
        "DATABASE_SSL_MODE must be disable, require, or verify-full",
      ),
    );
  });
});

describe("sanitized PostgreSQL diagnostics", () => {
  it("classifies an SSL-unsupported server without leaking connection details", () => {
    const result = classifyDatabaseError(new Error("The server does not support SSL connections"));
    expect(result.databaseCode).toBe("SSL_UNSUPPORTED");
    expect(result.message).toBe("PostgreSQL server does not support the configured SSL mode");
    expect(result.message).not.toContain("postgres:");
  });

  it.each([
    ["ECONNREFUSED", "CONNECTION_REFUSED"],
    ["28P01", "AUTHENTICATION_FAILED"],
    ["3D000", "DATABASE_MISSING"],
    ["42P01", "MIGRATION_MISSING"],
    ["ETIMEDOUT", "CONNECTION_TIMEOUT"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "CERTIFICATE_VERIFICATION_FAILED"],
  ])("maps %s to %s", (code, expected) => {
    expect(classifyDatabaseError({ code }).databaseCode).toBe(expected);
  });
});
