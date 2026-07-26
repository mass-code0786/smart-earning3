import { query } from "./db";

export async function userDashboard(wallet: string) {
  const userResult = await query<{
    id: string;
    wallet_address: string;
    direct_count: number;
    sponsor_wallet: string | null;
    tx_hash: string | null;
    registration_status: string | null;
  }>(
    `SELECT u.id,u.wallet_address,u.direct_count,s.wallet_address sponsor_wallet,
            r.tx_hash,r.status registration_status
     FROM users u
     LEFT JOIN referral_relations rr ON rr.user_id=u.id
     LEFT JOIN users s ON s.id=rr.sponsor_user_id
     LEFT JOIN registrations r ON r.user_id=u.id
     WHERE u.wallet_address=$1`,
    [wallet],
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const [magic, direct, today, histories, levels, financial, earningHistory] = await Promise.all([
    query<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text balance
       FROM magic_wallet_ledger WHERE user_id=$1`,
      [user.id],
    ),
    query<{ total: string }>(
      "SELECT COALESCE(SUM(amount_token_units),0)::text total FROM direct_income_ledger WHERE sponsor_user_id=$1",
      [user.id],
    ),
    query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_token_units),0)::text total FROM direct_income_ledger
       WHERE sponsor_user_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [user.id],
    ),
    query<{
      id: string;
      amount_token_units: string;
      tx_hash: string;
      source_wallet: string;
      created_at: Date;
    }>(
      `SELECT d.id,d.amount_token_units::text,d.tx_hash,u.wallet_address source_wallet,d.created_at
       FROM direct_income_ledger d JOIN users u ON u.id=d.source_user_id
       WHERE d.sponsor_user_id=$1 ORDER BY d.created_at DESC LIMIT 100`,
      [user.id],
    ),
    query<{ matrix_level: number; status: string; amount: string; cycle_date: string }>(
      `SELECT m.matrix_level,m.status,m.amount_token_units::text amount,c.cycle_date::text
       FROM magic_income_ledger m JOIN distribution_cycles c ON c.id=m.distribution_cycle_id
       WHERE m.beneficiary_user_id=$1 ORDER BY c.cycle_date DESC,m.matrix_level LIMIT 200`,
      [user.id],
    ),
    query<{
      income_wallet: string; income_reserved: string; total_withdrawn: string;
      hold_wallet: string; booster_wallet: string; dividend_income: string;
      gross_earned: string; magic_contribution: string; income_credited: string;
      cap_total: string; cap_used: string; cap_remaining: string; active_package: string;
    }>(`SELECT
      (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text FROM income_wallet_ledger WHERE user_id=$1) income_wallet,
      (SELECT COALESCE(sum(gross_reserved),0)::text FROM auto_withdrawals WHERE user_id=$1 AND status IN('PENDING','RESERVED','BROADCASTING','BROADCASTED','FAILED_RETRYABLE')) income_reserved,
      (SELECT COALESCE(sum(net_payout),0)::text FROM auto_withdrawals WHERE user_id=$1 AND status='CONFIRMED') total_withdrawn,
      (SELECT COALESCE(sum(CASE status WHEN 'HELD' THEN amount ELSE 0 END),0)::text FROM x3_hold_ledger WHERE user_id=$1) hold_wallet,
      (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text FROM booster_wallet_ledger WHERE user_id=$1) booster_wallet,
      (SELECT COALESCE(sum(amount),0)::text FROM daily_dividend_allocations WHERE user_id=$1) dividend_income,
      (SELECT COALESCE(sum(capped_gross_credit),0)::text FROM earning_split_events WHERE user_id=$1) gross_earned,
      (SELECT COALESCE(sum(magic_amount),0)::text FROM earning_split_events WHERE user_id=$1) magic_contribution,
      (SELECT COALESCE(sum(income_amount),0)::text FROM earning_split_events WHERE user_id=$1) income_credited,
      COALESCE((SELECT total_earning_cap::text FROM user_package_states WHERE user_id=$1),'0') cap_total,
      COALESCE((SELECT total_earned::text FROM user_package_states WHERE user_id=$1),'0') cap_used,
      COALESCE((SELECT remaining_cap::text FROM user_package_states WHERE user_id=$1),'0') cap_remaining,
      COALESCE((SELECT total_package_value::text FROM user_package_states WHERE user_id=$1),'0') active_package`, [user.id]),
    query(`SELECT id,income_type,source_reference,gross_calculated::text,capped_gross_credit::text,
      capped_excess::text,magic_amount::text,income_amount::text,created_at
      FROM earning_split_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [user.id]),
  ]);

  return {
    ...user,
    magicBalance: magic.rows[0].balance,
    directIncomeTotal: direct.rows[0].total,
    directIncomeToday: today.rows[0].total,
    directIncomeHistory: histories.rows,
    magicIncomeHistory: levels.rows,
    financial: financial.rows[0],
    earningHistory: earningHistory.rows,
  };
}

export async function adminOverview(search?: string) {
  const term = search?.trim();
  const [stats, cycle, users, transactions] = await Promise.all([
    query<{
      registrations: number;
      sponsor_income: string;
      magic_balance: string;
      distributed: string;
      pending: string;
    }>(`SELECT
      (SELECT count(*)::int FROM registrations WHERE status='CONFIRMED') registrations,
      (SELECT COALESCE(sum(amount_token_units),0)::text FROM direct_income_ledger) sponsor_income,
      (SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text FROM magic_wallet_ledger) magic_balance,
      (SELECT COALESCE(sum(amount_token_units) FILTER (WHERE status='CLAIMABLE'),0)::text FROM magic_income_ledger) distributed,
      (SELECT COALESCE(sum(amount_token_units) FILTER (WHERE status<>'CLAIMABLE'),0)::text FROM magic_income_ledger) pending`),
    query("SELECT * FROM distribution_cycles ORDER BY cycle_date DESC LIMIT 1"),
    query(
      `SELECT wallet_address,status,direct_count,created_at FROM users
       WHERE $1::text IS NULL OR wallet_address ILIKE '%'||$1||'%'
       ORDER BY created_at DESC LIMIT 50`,
      [term || null],
    ),
    query(
      `SELECT tx_hash,status,event_name,block_number,created_at FROM blockchain_transactions
       WHERE $1::text IS NULL OR tx_hash ILIKE '%'||$1||'%'
       ORDER BY created_at DESC LIMIT 50`,
      [term || null],
    ),
  ]);
  return { stats: stats.rows[0], currentCycle: cycle.rows[0] || null, users: users.rows, transactions: transactions.rows };
}
