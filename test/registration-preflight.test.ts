// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  getNetwork: vi.fn(),
  getCode: vi.fn(),
}));

vi.mock("@/lib/server/db", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/db")>(),
  query: (...args: unknown[]) => state.query(...args),
}));
vi.mock("@/lib/blockchain/provider", () => ({
  getProvider: () => ({ getNetwork: state.getNetwork, getCode: state.getCode }),
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
  });

  it("allows a new registrant with an active sponsor and complete dependencies", async () => {
    await expect(registrationPreflight(registrant, sponsor)).resolves.toEqual({ registrant, sponsor });
    expect(state.getCode).toHaveBeenCalledTimes(2);
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
    state.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("schema_migrations")) return { rows: [{ applied: false }] };
      if (sql.includes("FROM users")) return { rows: [{ active: values?.[0] === sponsor }] };
      return { rows: [] };
    });
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
    await registrationPreflight(registrant, sponsor);
    const migrationSql = String(state.query.mock.calls.find(call =>
      String(call[0]).includes("schema_migrations"))?.[0]);
    expect(migrationSql).toContain("filename='022_activity_history.sql'");
    expect(migrationSql).not.toMatch(/\b(?:migration_name|version|name)\b\s*=/);

    state.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("schema_migrations")) throw Object.assign(new Error("column failure"), { code: "42703" });
      if (sql.includes("FROM users")) return { rows: [{ active: values?.[0] === sponsor }] };
      return { rows: [] };
    });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      stage: "CHECK_HISTORY_MIGRATION",
      original: expect.objectContaining({ code: "42703" }),
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
