import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";

export async function getWalletSummary(sessionWallet: string) {
  const authenticatedWallet = normalizeWallet(sessionWallet);
  const user = (await query<{ id: string; wallet_address: string }>(
    `SELECT id,wallet_address FROM users
     WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'`,
    [authenticatedWallet],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");

  const result = (await query<{
    income_wallet: string; magic_wallet: string; hold_wallet: string;
    booster_wallet: string; gross_earned: string; total_withdrawn: string;
    income_reserved: string; dividend_income: string; cap_used: string;
    cap_remaining: string; active_package: string; direct_members: number;
    total_team: number; highest_package_id: number; current_package_name: string | null;
    next_entry_at: string | null; booster_active: boolean; earliest_hold_expires_at:string|null;
  }>(
    `WITH RECURSIVE account_team AS (
       SELECT rr.user_id FROM referral_relations rr WHERE rr.sponsor_user_id=$1
       UNION
       SELECT rr.user_id FROM referral_relations rr
       JOIN account_team parent ON parent.user_id=rr.sponsor_user_id
     )
     SELECT
       (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text
        FROM income_wallet_ledger WHERE user_id=$1) income_wallet,
       (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text
        FROM magic_wallet_ledger WHERE user_id=$1) magic_wallet,
       (SELECT COALESCE(sum(amount),0)::text
       FROM x3_hold_ledger WHERE user_id=$1 AND status='HELD') hold_wallet,
       (SELECT min(expires_at)::text FROM x3_hold_ledger
        WHERE user_id=$1 AND status='HELD' AND expires_at IS NOT NULL) earliest_hold_expires_at,
       (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text
        FROM booster_wallet_ledger WHERE user_id=$1) booster_wallet,
       (SELECT COALESCE(sum(capped_gross_credit),0)::text
        FROM earning_split_events WHERE user_id=$1) gross_earned,
       (SELECT COALESCE(sum(net_payout),0)::text
        FROM auto_withdrawals WHERE user_id=$1 AND status='CONFIRMED') total_withdrawn,
       (SELECT COALESCE(sum(gross_reserved),0)::text
        FROM auto_withdrawals WHERE user_id=$1
          AND status IN('PENDING','RESERVED','BROADCASTING','BROADCASTED','FAILED_RETRYABLE')) income_reserved,
       (SELECT COALESCE(sum(amount),0)::text
        FROM daily_dividend_allocations WHERE user_id=$1) dividend_income,
       COALESCE((SELECT total_earned::text FROM user_package_states WHERE user_id=$1),'0') cap_used,
       COALESCE((SELECT remaining_cap::text FROM user_package_states WHERE user_id=$1),'0') cap_remaining,
       COALESCE((SELECT total_package_value::text FROM user_package_states WHERE user_id=$1),'0') active_package,
       (SELECT count(*)::int FROM referral_relations WHERE sponsor_user_id=$1) direct_members,
       (SELECT count(*)::int FROM account_team) total_team,
       COALESCE((SELECT highest_package_id FROM user_package_states WHERE user_id=$1),0) highest_package_id,
       (SELECT pd.name FROM user_package_states ups
        JOIN package_definitions pd ON pd.serial_number=ups.highest_package_id
        WHERE ups.user_id=$1 AND ups.highest_package_id>0) current_package_name,
       (SELECT next_entry_at::text FROM booster_memberships WHERE user_id=$1) next_entry_at,
       EXISTS(SELECT 1 FROM booster_memberships WHERE user_id=$1) booster_active`,
    [user.id],
  )).rows[0];

  const boosterBalance = BigInt(result?.booster_wallet || "0");
  const serverTime = new Date();
  const nextEntryAt = result?.next_entry_at || null;
  const eligibility = !result?.booster_active ? "INACTIVE"
    : boosterBalance < 2_500_000n ? "INSUFFICIENT_BALANCE"
      : !nextEntryAt ? "ERROR"
        : new Date(nextEntryAt).getTime() <= serverTime.getTime() ? "DUE" : "NOT_DUE";

  return {
    authenticatedWallet,
    user: {
      wallet_address: user.wallet_address,
      direct_count: result?.direct_members || 0,
      magicBalance: result?.magic_wallet || "0",
      financial: {
        income_wallet: result?.income_wallet || "0",
        income_reserved: result?.income_reserved || "0",
        total_withdrawn: result?.total_withdrawn || "0",
        hold_wallet: result?.hold_wallet || "0",
        booster_wallet: result?.booster_wallet || "0",
        dividend_income: result?.dividend_income || "0",
        gross_earned: result?.gross_earned || "0",
        cap_used: result?.cap_used || "0",
        cap_remaining: result?.cap_remaining || "0",
        active_package: result?.active_package || "0",
      },
    },
    booster: {
      server_time: serverTime.toISOString(),
      next_entry_at: nextEntryAt,
      eligibility,
      booster_wallet_balance: result?.booster_wallet || "0",
    },
    currentPackage: result?.highest_package_id ? {
      packageId: result.highest_package_id,
      name: result.current_package_name || `Package ${result.highest_package_id}`,
    } : null,
    x3Hold: { earliestExpiresAt: result?.earliest_hold_expires_at || null },
    serverTime: serverTime.toISOString(),
    team: { totalTeam: result?.total_team || 0 },
  };
}
