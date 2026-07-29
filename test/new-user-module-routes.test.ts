// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const wallet = "0x00000000000000000000000000000000000000bb";
const x3 = Array.from({ length: 8 }, (_, index) => ({
  packageId: index + 1, active: false, earnedIncome: "0", slots: [],
}));
const x4 = Array.from({ length: 8 }, (_, index) => ({
  packageId: index + 1, active: false, totalEarnings: "0", slots: [],
}));
const booster = {
  booster_wallet_balance: "0", boosterActive: false, next_entry_at: null,
  eligibility: "INACTIVE", entries: [], walletHistory: [], entryHistory: [], topUpHistory: [],
};

vi.mock("@/lib/server/auth", () => ({
  requireSession: async () => ({ wallet, chainId: 97 }),
}));
vi.mock("@/lib/server/x3-query-service", () => ({
  getX3Packages: async () => x3,
}));
vi.mock("@/lib/server/x4-query-service", () => ({
  getX4Packages: async () => ({ packages: x4, history: [] }),
}));
vi.mock("@/lib/server/booster-query-service", () => ({
  getBoosterDashboard: async () => booster,
}));

import { GET as getX3 } from "@/app/api/x3/packages/route";
import { GET as getX4 } from "@/app/api/x4/packages/route";
import { GET as getBooster } from "@/app/api/booster/route";

describe("new-user optional module API routes", () => {
  it("returns HTTP 200 for empty X3 state", async () => {
    const response = await getX3();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ packages: x3 });
  });

  it("returns HTTP 200 for empty X4 state", async () => {
    const response = await getX4();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ packages: x4, history: [] });
  });

  it("returns HTTP 200 for default Booster state", async () => {
    const response = await getBooster();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(booster);
  });
});
