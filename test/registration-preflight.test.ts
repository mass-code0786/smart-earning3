// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  getNetwork: vi.fn(),
  getCode: vi.fn(),
  requireSchemaReady: vi.fn(),
}));

vi.mock("@/lib/server/db", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/db")>(),
  query: (...args: unknown[]) => state.query(...args),
}));
vi.mock("@/lib/blockchain/provider", () => ({
  getProvider: () => ({ getNetwork: state.getNetwork, getCode: state.getCode }),
}));
vi.mock("@/lib/server/registration-schema-readiness", () => ({
  requireRegistrationSchemaReady: (...args: unknown[]) => state.requireSchemaReady(...args),
}));
vi.mock("@/lib/server/config", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/config")>(),
  CHAIN_ID: 97,
  getServerConfig: () => ({
    SMART_EARNING_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000011",
    BSC_TESTNET_USDT_ADDRESS: "0x0000000000000000000000000000000000000022",
  }),
}));

import {
  registrationPreflight, RegistrationStageFailure, safeRegistrationError,
} from "@/lib/server/registration-preflight";

const registrant = "0x00000000000000000000000000000000000000bb";
const sponsor = "0x00000000000000000000000000000000000000aa";

describe("registration preparation preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("schema_migrations")) return { rows: [{ applied: true }] };
      if (sql.includes("to_regclass")) return { rows: [{ history_table: true, history_trigger: true }] };
      if (sql.includes("FROM users")) {
        return { rows: [{ active: values?.[0] === sponsor }] };
      }
      throw new Error("Unexpected query");
    });
    state.getNetwork.mockResolvedValue({ chainId: 97n });
    state.getCode.mockResolvedValue("0x6000");
    state.requireSchemaReady.mockResolvedValue({ registrationReady: true });
  });

  it("allows a new registrant with an active sponsor and complete dependencies", async () => {
    await expect(registrationPreflight(registrant, sponsor)).resolves.toEqual({ registrant, sponsor });
    expect(state.getCode).toHaveBeenCalledTimes(2);
  });

  it("normalizes sponsor address case without allowing an unregistered wallet", async () => {
    const mixedCaseSponsor = "0x00000000000000000000000000000000000000AA";
    await expect(registrationPreflight(registrant, mixedCaseSponsor)).resolves.toEqual({
      registrant,
      sponsor,
    });
    const random = "0x00000000000000000000000000000000000000cc";
    await expect(registrationPreflight(registrant, random)).rejects.toMatchObject({
      stage: "CHECK_SPONSOR",
      original: expect.objectContaining({ code: "SPONSOR_NOT_ACTIVE" }),
    });
  });

  it("returns stable non-500 expected registration errors", async () => {
    state.query.mockImplementation(async (sql: string) => sql.includes("FROM users")
      ? { rows: [{ active: false }] }
      : { rows: [{ applied: true, history_table: true, history_trigger: true }] });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_SPONSOR",
      original: expect.objectContaining({ status: 422, code: "SPONSOR_NOT_ACTIVE" }),
    });

    state.query.mockResolvedValueOnce({ rows: [{ active: true }] });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_REGISTRANT",
      original: expect.objectContaining({ status: 409, code: "ALREADY_REGISTERED" }),
    });
  });

  it("reports an unapplied or incomplete history migration explicitly", async () => {
    state.requireSchemaReady.mockRejectedValue(Object.assign(
      new Error("Registration history dependency is not installed"),
      { status: 503, code: "HISTORY_MIGRATION_MISSING" },
    ));
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_HISTORY_MIGRATION",
      original: expect.objectContaining({
        status: 503,
        code: "HISTORY_MIGRATION_MISSING",
        message: "Registration history dependency is not installed",
      }),
    });
    expect(state.getNetwork).not.toHaveBeenCalled();
  });

  it("maps RPC failure without exposing provider internals", async () => {
    state.getNetwork.mockRejectedValue(new Error("private upstream URL detail"));
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_RPC",
    });
  });

  it("uses schema_migrations.filename and does not swallow SQL errors", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const migrationSql = readFileSync(
      resolve("lib/server/registration-schema-readiness.ts"), "utf8",
    );
    expect(migrationSql).toContain("filename=$1");

    state.requireSchemaReady.mockRejectedValue(Object.assign(
      new Error("Database schema is incompatible"),
      { status: 503, code: "DATABASE_SCHEMA_INCOMPATIBLE" },
    ));
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_HISTORY_MIGRATION",
      original: expect.objectContaining({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }),
    });
  });

  it("maps an unknown placement exception to a stable placement error", () => {
    const safe = safeRegistrationError(new RegistrationStageFailure(
      "ENSURE_PLACEMENT",
      new Error("provider simulation detail"),
    ));
    expect(safe).toMatchObject({
      status: 503,
      code: "REGISTRATION_PLACEMENT_UNAVAILABLE",
      message: "Registration placement is temporarily unavailable",
    });
  });
});
