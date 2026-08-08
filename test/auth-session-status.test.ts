// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wallet: "0x000000000000000000000000000000000000dead",
  row: { registered: true, status: "ACTIVE" } as {
    registered: boolean;
    status: string | null;
  },
  query: vi.fn(),
  onchainRegistered: false,
}));

vi.mock("@/lib/server/auth", () => ({
  requireSession: async () => ({ wallet: state.wallet, chainId: 97 }),
}));
vi.mock("@/lib/server/db", () => ({
  query: (...args: unknown[]) => state.query(...args),
}));
vi.mock("@/lib/blockchain/provider", () => ({
  getSmartEarningContract: () => ({ registered: async () => state.onchainRegistered }),
}));

import { GET } from "@/app/api/auth/session/route";

describe("authenticated registration status", () => {
  beforeEach(() => {
    process.env.ADMIN_WALLETS = state.wallet;
    state.wallet = "0x000000000000000000000000000000000000dead";
    state.row = { registered: true, status: "ACTIVE" };
    state.query.mockReset();
    state.query.mockImplementation(async () => ({ rows: [state.row] }));
    state.onchainRegistered = false;
  });

  it("returns registered for a valid session with an indexed active user", async () => {
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      wallet: state.wallet,
      chainId: 97,
      registered: true,
      registrationStatus: "ACTIVE",
      registrationState: "ACTIVE",
      isAdmin: true,
    });
    expect(state.query.mock.calls[0][0]).toContain("lower(wallet_address)=lower($1)");
    expect(state.query.mock.calls[0][0]).toContain("status='ACTIVE'");
  });

  it("uses case-insensitive lookup for a mixed-case authenticated wallet", async () => {
    state.wallet = "0x000000000000000000000000000000000000dEaD";
    await GET();
    expect(state.query.mock.calls[0][1]).toEqual([state.wallet]);
  });

  it("returns unregistered for a genuinely unindexed wallet", async () => {
    state.row = { registered: false, status: null };
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      registered: false,
      registrationStatus: null,
      registrationState: "UNREGISTERED",
    });
  });

  it("does not classify an on-chain registration with a lagging projection as unregistered", async () => {
    state.row = { registered: false, status: null };
    state.onchainRegistered = true;
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({
      registered: false,
      registrationState: "SYNCHRONIZATION_PENDING",
    });
  });

  it("does not expose admin status for an unlisted wallet", async () => {
    process.env.ADMIN_WALLETS = "0x1111111111111111111111111111111111111111";
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ isAdmin: false });
  });
});
