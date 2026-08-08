// @vitest-environment node
import { describe, expect, it } from "vitest";

const {
  assertSafeTestDatabaseUrl,
  clientConfig,
  explicitTestDatabaseUrl,
  integrationEnvironment,
} = require("../scripts/test-database.cjs");

describe("isolated PostgreSQL test database selection", () => {
  const production = "postgresql://prod:secret@127.0.0.1:5432/smartearning";

  it("accepts an explicit isolated native PostgreSQL database", () => {
    const url = assertSafeTestDatabaseUrl(
      "postgresql://tests:test-secret@127.0.0.1:5432/smartearning_test",
      production,
    );
    expect(clientConfig(url)).toMatchObject({
      user: "tests", password: "test-secret", database: "smartearning_test", ssl: false,
    });
  });

  it("fails closed for production-like, identical, or passwordless targets", () => {
    expect(() => assertSafeTestDatabaseUrl(production, production)).toThrow(/test|production/i);
    expect(() => assertSafeTestDatabaseUrl(
      "postgresql://tests:secret@127.0.0.1:5432/temporary", production,
    )).toThrow(/test.*marker/i);
    expect(() => assertSafeTestDatabaseUrl(
      "postgresql://tests@127.0.0.1:5432/smartearning_test", production,
    )).toThrow(/password/i);
  });

  it("propagates one deterministic URL to every PostgreSQL integration suite", () => {
    const selected = explicitTestDatabaseUrl({
      SMART_EARNING_TEST_DATABASE_URL: "postgresql://tests:secret@db/smartearning_test",
      TEST_DATABASE_URL: "postgresql://ignored:secret@db/ignored_test",
    });
    expect(selected?.key).toBe("SMART_EARNING_TEST_DATABASE_URL");
    const url = new URL(selected!.value);
    const environment = integrationEnvironment(url, {});
    expect(environment.DATABASE_URL).toBe(url.toString());
    for (const key of [
      "PLACEMENT_TEST_DATABASE_URL", "BOOSTER_TEST_DATABASE_URL", "DIVIDEND_TEST_DATABASE_URL",
      "OPERATIONS_TEST_DATABASE_URL", "FINANCIAL_TEST_DATABASE_URL", "AUTOPOOL_TEST_DATABASE_URL",
      "X4_TEST_DATABASE_URL", "X3_DIRECT_TEST_DATABASE_URL",
    ]) expect(environment[key]).toBe(url.toString());
  });
});
