// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/server/db", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/db")>(),
  getPool: () => ({ query: state.query }),
}));

import {
  getRegistrationSchemaReadiness,
  REQUIRED_HISTORY_COLUMNS,
  REQUIRED_HISTORY_TRIGGERS,
  requireRegistrationSchemaReady,
  resetRegistrationSchemaReadinessForTests,
} from "@/lib/server/registration-schema-readiness";

function row(overrides: Record<string, unknown> = {}) {
  return {
    current_database: "production",
    current_schema: "public",
    search_path: '"$user", public',
    migration_022: true,
    repair_migration_024: true,
    history_table: true,
    history_function: true,
    trigger_names: [...REQUIRED_HISTORY_TRIGGERS],
    column_names: [...REQUIRED_HISTORY_COLUMNS],
    ...overrides,
  };
}

describe("registration schema readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistrationSchemaReadinessForTests();
    state.query.mockImplementation(async (sql: string) => ({
      rows: [sql.includes("schema_migrations_table")
        ? {
          current_database: "production",
          current_schema: "public",
          search_path: '"$user", public',
          schema_migrations_table: true,
        }
        : row()],
    }));
  });

  it("allows a valid schema without HISTORY_MIGRATION_MISSING", async () => {
    await expect(requireRegistrationSchemaReady()).resolves.toMatchObject({
      registrationReady: true,
      migration022: true,
    });
  });

  it.each([
    ["migration row", { migration_022: false }],
    ["table", { history_table: false }],
    ["function", { history_function: false }],
    ["trigger", { trigger_names: REQUIRED_HISTORY_TRIGGERS.slice(1) }],
  ])("returns HISTORY_MIGRATION_MISSING for a missing %s", async (_name, overrides) => {
    state.query.mockImplementation(async (sql: string) => ({
      rows: [sql.includes("schema_migrations_table")
        ? {
          current_database: "production",
          current_schema: "public",
          search_path: "public",
          schema_migrations_table: true,
        }
        : row(overrides)],
    }));
    await expect(requireRegistrationSchemaReady()).rejects.toMatchObject({
      code: "HISTORY_MIGRATION_MISSING",
    });
  });

  it.each([
    ["ECONNREFUSED", "DATABASE_UNAVAILABLE"],
    ["42501", "DATABASE_PERMISSION_DENIED"],
    ["42703", "DATABASE_SCHEMA_INCOMPATIBLE"],
  ])("maps PostgreSQL %s precisely", async (postgresCode, apiCode) => {
    state.query.mockRejectedValue(Object.assign(new Error("database failure"), {
      code: postgresCode,
    }));
    await expect(requireRegistrationSchemaReady()).rejects.toMatchObject({ code: apiCode });
  });

  it("does not classify an unrelated undefined column as history migration missing", async () => {
    state.query.mockRejectedValue(Object.assign(new Error("unrelated column"), { code: "42703" }));
    await expect(requireRegistrationSchemaReady()).rejects.not.toMatchObject({
      code: "HISTORY_MIGRATION_MISSING",
    });
  });

  it("caches readiness and force-revalidates", async () => {
    await getRegistrationSchemaReadiness();
    await getRegistrationSchemaReadiness();
    expect(state.query).toHaveBeenCalledTimes(2);
    await getRegistrationSchemaReadiness({ force: true });
    expect(state.query).toHaveBeenCalledTimes(4);
  });

  it("cache invalidation causes the next read to revalidate", async () => {
    const { invalidateRegistrationSchemaReadiness } = await import(
      "@/lib/server/registration-schema-readiness"
    );
    await getRegistrationSchemaReadiness();
    invalidateRegistrationSchemaReadiness();
    await getRegistrationSchemaReadiness();
    expect(state.query).toHaveBeenCalledTimes(4);
  });
});
