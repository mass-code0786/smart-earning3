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

import { registrationPreflight } from "@/lib/server/registration-preflight";

const registrant = "0x00000000000000000000000000000000000000bb";
const sponsor = "0x00000000000000000000000000000000000000aa";

function databaseState(overrides = {}) {
  return {
    registrant_active: false,
    sponsor_active: true,
    history_migration: true,
    history_table: true,
    history_trigger: true,
    ...overrides,
  };
}

describe("registration preparation preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.query.mockResolvedValue({ rows: [databaseState()] });
    state.getNetwork.mockResolvedValue({ chainId: 97n });
    state.getCode.mockResolvedValue("0x6000");
  });

  it("allows a new registrant with an active sponsor and complete dependencies", async () => {
    await expect(registrationPreflight(registrant, sponsor)).resolves.toEqual({ registrant, sponsor });
    expect(state.getCode).toHaveBeenCalledTimes(2);
  });

  it("returns stable non-500 expected registration errors", async () => {
    state.query.mockResolvedValueOnce({ rows: [databaseState({ sponsor_active: false })] });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      status: 422, code: "SPONSOR_NOT_ACTIVE",
    });

    state.query.mockResolvedValueOnce({ rows: [databaseState({ registrant_active: true })] });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      status: 409, code: "ALREADY_REGISTERED",
    });
  });

  it("reports an unapplied or incomplete history migration explicitly", async () => {
    state.query.mockResolvedValue({ rows: [databaseState({
      history_migration: false,
      history_table: false,
      history_trigger: false,
    })] });
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      status: 503,
      code: "HISTORY_MIGRATION_MISSING",
      message: "Registration history dependency is not installed",
    });
    expect(state.getNetwork).not.toHaveBeenCalled();
  });

  it("maps RPC failure without exposing provider internals", async () => {
    state.getNetwork.mockRejectedValue(new Error("private upstream URL detail"));
    await expect(registrationPreflight(registrant, sponsor)).rejects.toMatchObject({
      status: 503,
      code: "RPC_UNAVAILABLE",
      message: "Registration RPC is unavailable",
    });
  });
});
