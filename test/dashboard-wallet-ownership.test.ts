// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ query }));

const sponsor = "0x00000000000000000000000000000000000000aa";
const referral = "0x00000000000000000000000000000000000000bb";

function installDashboardFixture(incomeRows: { income_type: string; total: string }[] = []) {
  query.mockImplementation(async (sqlInput: string, values: unknown[]) => {
    const sql = String(sqlInput);
    if (sql.includes("FROM users u") && sql.includes("LEFT JOIN referral_relations")) {
      const wallet = String(values[0]).toLowerCase();
      if (wallet === sponsor) {
        return { rows: [{
          id: "sponsor-id", wallet_address: sponsor, sponsor_wallet: null,
          tx_hash: "sponsor-tx", registration_status: "CONFIRMED",
        }] };
      }
      if (wallet === referral) {
        return { rows: [{
          id: "referral-id", wallet_address: referral, sponsor_wallet: sponsor,
          tx_hash: "referral-tx", registration_status: "CONFIRMED",
        }] };
      }
      return { rows: [] };
    }
    if (sql.includes("WITH RECURSIVE account_team")) {
      return {
        rows: [values[0] === "sponsor-id"
          ? { direct_members: 1, total_team: 1 }
          : { direct_members: 0, total_team: 0 }],
      };
    }
    if (sql.includes("FROM magic_wallet_ledger")) return { rows: [{ balance: "0" }] };
    if (sql.includes("FROM direct_income_ledger") && sql.includes("SUM(")) {
      return { rows: [{ total: "0" }] };
    }
    if (sql.includes("FROM direct_income_ledger d")) return { rows: [] };
    if (sql.includes("FROM magic_income_ledger")) return { rows: [] };
    if (sql.includes("income_wallet_ledger")) {
      return { rows: [{
        income_wallet: "0", income_reserved: "0", total_withdrawn: "0",
        hold_wallet: "0", booster_wallet: "0", dividend_income: "0",
        gross_earned: "0", magic_contribution: "0", income_credited: "0",
        cap_total: "0", cap_used: "0", cap_remaining: "0", active_package: "0",
      }] };
    }
    if (sql.includes("FROM earning_split_events")) return { rows: [] };
    if (sql.includes("FROM income_credit_ledger")) return { rows: incomeRows };
    throw new Error(`Unexpected dashboard query: ${sql}`);
  });
}

describe("dashboard wallet ownership", () => {
  beforeEach(() => {
    query.mockReset();
    installDashboardFixture();
  });

  it("keeps sponsor and newly registered referral statistics isolated", async () => {
    const { userDashboard } = await import("@/lib/server/dashboard-service");
    const sponsorDashboard = await userDashboard(sponsor);
    const referralDashboard = await userDashboard(referral);

    expect(sponsorDashboard).toMatchObject({
      wallet_address: sponsor,
      direct_count: 1,
      total_team: 1,
      accountStatistics: { directMembers: 1, totalTeam: 1 },
      sponsor: null,
    });
    expect(referralDashboard).toMatchObject({
      wallet_address: referral,
      direct_count: 0,
      total_team: 0,
      accountStatistics: { directMembers: 0, totalTeam: 0 },
      sponsor: { walletAddress: sponsor },
    });
  });

  it("normalizes mixed-case wallets and does not leak values between calls", async () => {
    const { userDashboard } = await import("@/lib/server/dashboard-service");
    const mixedReferral = `0x${referral.slice(2).toUpperCase()}`;

    const first = await userDashboard(sponsor);
    const second = await userDashboard(mixedReferral);

    expect(first?.direct_count).toBe(1);
    expect(second?.direct_count).toBe(0);
    expect(second?.total_team).toBe(0);
    const identityQueries = query.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM users u") && String(sql).includes("LEFT JOIN referral_relations"));
    expect(identityQueries.at(-1)?.[1]).toEqual([referral]);
  });

  it("anchors direct and recursive counts to the authenticated user's id", async () => {
    const { userDashboard } = await import("@/lib/server/dashboard-service");
    await userDashboard(referral);
    const teamCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("WITH RECURSIVE account_team"));
    expect(teamCall?.[1]).toEqual(["referral-id"]);
    expect(String(teamCall?.[0])).toContain("WHERE rr.sponsor_user_id=$1");
    expect(String(teamCall?.[0])).toContain("WHERE direct.sponsor_user_id=$1");
  });

  it("returns every canonical income total from credited financial ledger records", async () => {
    query.mockReset();
    installDashboardFixture([
      { income_type: "DIRECT_INCOME", total: "1250000" },
      { income_type: "X4_GLOBAL", total: "3000000" },
    ]);
    const { userDashboard } = await import("@/lib/server/dashboard-service");
    const dashboard = await userDashboard(sponsor);

    expect(dashboard?.incomeTotals).toHaveLength(8);
    expect(dashboard?.incomeTotals).toContainEqual({ incomeType: "DIRECT_INCOME", total: "1250000" });
    expect(dashboard?.incomeTotals).toContainEqual({ incomeType: "X4_GLOBAL", total: "3000000" });
    expect(dashboard?.incomeTotals).toContainEqual({ incomeType: "BOOSTER", total: "0" });
    const totalsCall = query.mock.calls.find(([sql]) => String(sql).includes("FROM income_credit_ledger"));
    expect(String(totalsCall?.[0])).toContain("sum(credited_amount)");
    expect(totalsCall?.[1]?.[0]).toBe("sponsor-id");
  });
});
