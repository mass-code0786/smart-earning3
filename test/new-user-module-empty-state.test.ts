// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({
  query: (...args: unknown[]) => query(...args),
}));

import { getX3Packages } from "@/lib/server/x3-query-service";
import { getX4Packages } from "@/lib/server/x4-query-service";
import { getBoosterDashboard } from "@/lib/server/booster-query-service";

const wallet = "0x00000000000000000000000000000000000000bb";

describe("ACTIVE new-user optional module read models", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id FROM users")) return { rows: [{ id: "user-b" }] };
      if (sql.includes("FROM booster_wallet_ledger WHERE user_id") && sql.includes(" balance")) {
        return { rows: [{ balance: "0", package_credits: "0", manual_top_ups: "0", refunds: "0", deductions: "0" }] };
      }
      if (sql.includes("FROM booster_entries e WHERE owner_user_id") && sql.includes("total_entries")) {
        return { rows: [{ total_entries: 0, active_entries: 0, completed_entries: 0, total_income: "0", pending_positions: 0 }] };
      }
      return { rows: [] };
    });
  });

  it("returns eight canonical inactive X3 packages instead of 404", async () => {
    const packages = await getX3Packages(wallet);
    expect(packages).toHaveLength(8);
    expect(packages.every(item => !item.active && item.earnedIncome === "0")).toBe(true);
    expect(String(query.mock.calls[0][0])).toContain("lower(wallet_address)=lower($1)");
  });

  it("returns eight canonical inactive X4 packages instead of 404", async () => {
    const result = await getX4Packages(wallet);
    expect(result.packages).toHaveLength(8);
    expect(result.packages.every(item => !item.active && item.totalEarnings === "0")).toBe(true);
    expect(result.history).toEqual([]);
  });

  it("returns the existing default Booster shape instead of 404", async () => {
    const result = await getBoosterDashboard(wallet);
    expect(result).toMatchObject({
      booster_wallet_balance: "0",
      boosterActive: false,
      next_entry_at: null,
      eligibility: "INACTIVE",
      entries: [],
      walletHistory: [],
      entryHistory: [],
      topUpHistory: [],
    });
  });
});
