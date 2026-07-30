// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ query }));

const sponsor = "0x00000000000000000000000000000000000000aa";
const referral = "0x00000000000000000000000000000000000000bb";

describe("wallet summary ownership", () => {
  beforeEach(() => query.mockReset());

  it("anchors every financial source to the resolved immutable user id", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "referral-id", wallet_address: referral }] })
      .mockResolvedValueOnce({ rows: [{
        income_wallet:"0",magic_wallet:"100000",hold_wallet:"0",booster_wallet:"0",
        gross_earned:"0",total_withdrawn:"0",income_reserved:"0",dividend_income:"0",
        cap_used:"0",cap_remaining:"10000000",active_package:"0",direct_members:0,
        total_team:0,highest_package_id:0,current_package_name:null,
        next_entry_at:null,booster_active:false,
      }] });
    const { getWalletSummary } = await import("@/lib/server/wallet-summary-service");
    const result = await getWalletSummary(`0x${referral.slice(2).toUpperCase()}`);

    expect(query.mock.calls[0][1]).toEqual([referral]);
    expect(query.mock.calls[1][1]).toEqual(["referral-id"]);
    const sql = String(query.mock.calls[1][0]);
    for (const table of [
      "income_wallet_ledger","magic_wallet_ledger","x3_hold_ledger",
      "booster_wallet_ledger","earning_split_events","auto_withdrawals",
      "daily_dividend_allocations",
    ]) {
      expect(sql).toMatch(new RegExp(`FROM ${table} WHERE user_id=\\$1`));
    }
    expect(sql).toContain("x3_hold_ledger WHERE user_id=$1 AND status='HELD'");
    expect(result.user.financial).toMatchObject({
      income_wallet:"0",hold_wallet:"0",booster_wallet:"0",gross_earned:"0",
      total_withdrawn:"0",income_reserved:"0",dividend_income:"0",
    });
    expect(result.user.magicBalance).toBe("100000");
  });

  it("does not leak sponsor balances to a referral or retain a previous call", async () => {
    query.mockImplementation(async (sqlInput: string, values: unknown[]) => {
      const sql = String(sqlInput);
      if (sql.includes("SELECT id,wallet_address")) {
        const wallet = String(values[0]).toLowerCase();
        return { rows: [{ id: wallet === sponsor ? "sponsor-id" : "referral-id", wallet_address: wallet }] };
      }
      const isSponsor = values?.[0] === "sponsor-id";
      return { rows: [{
        income_wallet:isSponsor?"900000":"0",magic_wallet:isSponsor?"100000":"0",
        hold_wallet:isSponsor?"510000000":"0",booster_wallet:"0",
        gross_earned:isSponsor?"1000000":"0",total_withdrawn:"0",
        income_reserved:"0",dividend_income:"0",cap_used:"0",cap_remaining:"0",
        active_package:"0",direct_members:isSponsor?1:0,total_team:isSponsor?1:0,
        highest_package_id:0,current_package_name:null,next_entry_at:null,booster_active:false,
      }] };
    });
    const { getWalletSummary } = await import("@/lib/server/wallet-summary-service");
    const sponsorResult = await getWalletSummary(sponsor);
    const referralResult = await getWalletSummary(referral);
    expect(sponsorResult.user.financial).toMatchObject({
      income_wallet:"900000",hold_wallet:"510000000",gross_earned:"1000000",
    });
    expect(referralResult.user.financial).toMatchObject({
      income_wallet:"0",hold_wallet:"0",gross_earned:"0",
    });
    expect(referralResult.user.magicBalance).toBe("0");
  });

  it("defaults missing user ledger rows to zero and contains no unscoped financial aggregate", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "new-id", wallet_address: referral }] })
      .mockResolvedValueOnce({ rows: [{}] });
    const { getWalletSummary } = await import("@/lib/server/wallet-summary-service");
    const result = await getWalletSummary(referral);
    expect(Object.values(result.user.financial)).toEqual([
      "0","0","0","0","0","0","0","0","0","0",
    ]);
    const sql = String(query.mock.calls[1][0]);
    const financialSubqueries = sql.match(/FROM (?:income_wallet_ledger|magic_wallet_ledger|x3_hold_ledger|booster_wallet_ledger|earning_split_events|auto_withdrawals|daily_dividend_allocations)[\s\S]*?(?=\),|\) [a-z_]+,)/g) || [];
    expect(financialSubqueries.length).toBeGreaterThan(0);
    expect(financialSubqueries.every(part => part.includes("user_id=$1"))).toBe(true);
  });
});
