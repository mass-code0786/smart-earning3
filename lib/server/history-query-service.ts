import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";

export const HISTORY_CATEGORIES = ["PACKAGES","REFERRALS","INCOME","MATRIX","AUTOPOOL","BOOSTER","MAGIC","DIVIDEND","WITHDRAWALS","WALLET"] as const;
export type HistoryCategory = typeof HISTORY_CATEGORIES[number];
const HISTORY_TYPE_FILTERS: Record<string, string> = {
  DIRECT_INCOME: "DIRECT_INCOME",
  MAGIC_LEVEL: "MAGIC_LEVEL_INCOME",
  X3: "X3",
  X4: "X4",
  BOOSTER_INCOME: "BOOSTER_INCOME",
};

export type HistoryFilters = {
  category?: string | null;
  status?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  limit?: number;
};

type Cursor = { createdAt: string; id: string };
function decodeCursor(value?: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed.id || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid history cursor", "INVALID_CURSOR");
  }
}
function encodeCursor(item: { created_at: Date | string; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: new Date(item.created_at).toISOString(), id: item.id })).toString("base64url");
}
function usdt(value: string | null) {
  if (value === null) return null;
  const amount = BigInt(value), whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}
function optionalDate(value: string | null | undefined, end = false) {
  if (!value) return null;
  const date = new Date(end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "Invalid history date", "INVALID_DATE");
  return date;
}

export async function getHistory(walletInput: string, filters: HistoryFilters = {}) {
  const wallet = normalizeWallet(walletInput);
  const requestedCategory = filters.category?.toUpperCase() || null;
  const typeFilter = requestedCategory ? HISTORY_TYPE_FILTERS[requestedCategory] || null : null;
  const category = typeFilter ? null : requestedCategory;
  if (category && !HISTORY_CATEGORIES.includes(category as HistoryCategory)) {
    throw new ApiError(400, "Invalid history category", "INVALID_CATEGORY");
  }
  const cursor = decodeCursor(filters.cursor);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const values = [
    wallet, category, filters.status?.trim().toUpperCase() || null,
    filters.search?.trim() || null, optionalDate(filters.from), optionalDate(filters.to, true),
    cursor?.createdAt || null, cursor?.id || null, limit + 1, typeFilter,
  ];
  const result = await query<any>(
    `WITH RECURSIVE viewer AS (
       SELECT id,wallet_address FROM users WHERE wallet_address=$1
     ), team(user_id,relationship_level) AS (
       SELECT rr.user_id,1 FROM referral_relations rr JOIN viewer v ON v.id=rr.sponsor_user_id
       UNION ALL
       SELECT rr.user_id,t.relationship_level+1 FROM referral_relations rr JOIN team t ON t.user_id=rr.sponsor_user_id
     ), history AS (
       SELECT 'package:'||p.id id,
         CASE WHEN p.package_id=1 THEN 'PACKAGE_PURCHASE' ELSE 'PACKAGE_UPGRADE' END type,
         'PACKAGES' category,p.amount_token_units::text amount,'USDT' currency,
         p.wallet_address source_wallet,p.amount_token_units::text package_amount,p.package_id,
         NULL::text matrix_type,NULL::int cycle,NULL::int recycle_count,p.status, p.tx_hash,
         COALESCE(p.purchased_at,p.created_at) created_at,
         CASE WHEN p.package_id=1 THEN 'Package 1 purchased' ELSE 'Package upgraded to package '||p.package_id END description,
         NULL::text income_type,NULL::int level,NULL::int position,
         jsonb_build_object('scope','OWN','currentActive',ups.highest_package_id=p.package_id) metadata
       FROM package_purchases p JOIN viewer v ON v.id=p.user_id LEFT JOIN user_package_states ups ON ups.user_id=p.user_id
       UNION ALL
       SELECT 'team-package:'||p.id,'TEAM_PACKAGE_'||CASE WHEN p.package_id=1 THEN 'PURCHASE' ELSE 'UPGRADE' END,
         'PACKAGES',p.amount_token_units::text,'USDT',u.wallet_address,p.amount_token_units::text,p.package_id,
         NULL,NULL,NULL,p.status,p.tx_hash,COALESCE(p.purchased_at,p.created_at),
         'Team member purchased package '||p.package_id,NULL,NULL,NULL,
         jsonb_build_object('scope','TEAM','relationshipLevel',t.relationship_level)
       FROM package_purchases p JOIN team t ON t.user_id=p.user_id JOIN users u ON u.id=p.user_id
       UNION ALL
       SELECT 'referral:'||r.id,'DIRECT_REFERRAL','REFERRALS',NULL,NULL,u.wallet_address,
         pp.amount_token_units::text,pp.package_id,NULL,NULL,NULL,u.status,r.tx_hash,COALESCE(r.confirmed_at,r.created_at),
         'Direct referral registered',NULL,NULL,NULL,
         jsonb_build_object('firstPackageAt',pp.purchased_at,'directIncomeGenerated',
           COALESCE((SELECT sum(d.amount_token_units)::text FROM direct_income_ledger d WHERE d.sponsor_user_id=v.id AND d.source_user_id=u.id),'0'))
       FROM registrations r JOIN viewer v ON v.id=r.sponsor_user_id JOIN users u ON u.id=r.user_id
       LEFT JOIN LATERAL (SELECT p.package_id,p.amount_token_units,p.purchased_at FROM package_purchases p
         WHERE p.user_id=u.id AND p.status='CONFIRMED' ORDER BY p.package_id LIMIT 1) pp ON true
       UNION ALL
       SELECT 'direct-income:'||d.id,'DIRECT_INCOME','INCOME',d.amount_token_units::text,'USDT',u.wallet_address,
         r.amount_token_units::text,NULL,NULL,NULL,NULL,'CONFIRMED',d.tx_hash,d.created_at,
         'Direct income received from referral','DIRECT_INCOME',NULL,NULL,
         jsonb_build_object('registrationId',d.registration_id)
       FROM direct_income_ledger d JOIN viewer v ON v.id=d.sponsor_user_id JOIN users u ON u.id=d.source_user_id
       JOIN registrations r ON r.id=d.registration_id
       UNION ALL
       SELECT 'magic-income:'||m.id,'MAGIC_LEVEL_INCOME','MAGIC',m.amount_token_units::text,'USDT',u.wallet_address,
         NULL,NULL,'MAGIC',NULL,NULL,m.status,c.tx_hash,m.created_at,'Magic Level income received',
         'MAGIC_LEVEL_INCOME',m.matrix_level,NULL,jsonb_build_object('cycleDate',c.cycle_date)
       FROM magic_income_ledger m JOIN viewer v ON v.id=m.beneficiary_user_id JOIN users u ON u.id=m.source_user_id
       JOIN distribution_cycles c ON c.id=m.distribution_cycle_id
       UNION ALL
       SELECT 'x3-income:'||x.id,'X3_MATRIX_INCOME','MATRIX',x.credited_amount::text,'USDT',u.wallet_address,
         pd.price_token_units::text,x.package_id,'X3',c.cycle_number,NULL,x.status,s.source_transaction_hash,x.created_at,
         'X3 package '||x.package_id||' matrix income received','X3_PACKAGE',NULL,s.slot_number,
         jsonb_build_object('grossAmount',x.gross_amount,'excessAmount',x.excess_amount)
       FROM x3_income_ledger x JOIN viewer v ON v.id=x.owner_user_id JOIN users u ON u.id=x.source_user_id
       JOIN x3_cycles c ON c.id=x.owner_cycle_id JOIN x3_cycle_slots s ON s.id=x.slot_id
       JOIN package_definitions pd ON pd.serial_number=x.package_id
       UNION ALL
       SELECT 'x4-income:'||x.id,'X4_MATRIX_INCOME','MATRIX',x.credited_amount::text,'USDT',u.wallet_address,
         pd.price_token_units::text,x.package_id,'X4',c.cycle_number,NULL,'CONFIRMED',p.source_transaction_hash,x.created_at,
         'X4 package '||x.package_id||' matrix income received','X4_'||x.wallet_type,x.level_number,p.slot_number,
         jsonb_build_object('grossAmount',x.gross_amount,'excessAmount',x.excess_amount)
       FROM x4_income_history x JOIN viewer v ON v.id=x.owner_user_id JOIN users u ON u.id=x.source_user_id
       JOIN x4_cycles c ON c.id=x.owner_cycle_id JOIN x4_positions p ON p.id=x.position_id
       JOIN package_definitions pd ON pd.serial_number=x.package_id
       UNION ALL
       SELECT 'x3-recycle:'||r.id,'X3_RECYCLE','MATRIX',NULL,NULL,NULL,pd.price_token_units::text,r.package_id,
         'X3',c.cycle_number,r.recycle_number,'COMPLETED',e.transaction_hash,r.created_at,
         'X3 package '||r.package_id||' recycled',NULL,NULL,NULL,
         jsonb_build_object('completedAt',c.completed_at,'filledPositions',3,
           'cycleEarnings',COALESCE((SELECT sum(i.credited_amount)::text FROM x3_income_ledger i WHERE i.owner_cycle_id=c.id),'0'),
           'positionWallets',COALESCE((SELECT jsonb_agg(u.wallet_address ORDER BY s.slot_number)
             FROM x3_cycle_slots s JOIN users u ON u.id=s.placed_user_id WHERE s.cycle_id=c.id),'[]'::jsonb))
       FROM x3_recycle_events r JOIN viewer v ON v.id=r.user_id JOIN x3_cycles c ON c.id=r.completed_cycle_id
       LEFT JOIN x3_placement_events e ON e.id=r.placement_event_id JOIN package_definitions pd ON pd.serial_number=r.package_id
       UNION ALL
       SELECT 'x4-recycle:'||r.id,'X4_RECYCLE','MATRIX',NULL,NULL,NULL,pd.price_token_units::text,r.package_id,
         'X4',c.cycle_number,r.recycle_number,'COMPLETED',p.source_transaction_hash,r.created_at,
         'X4 package '||r.package_id||' recycled',NULL,NULL,NULL,
         jsonb_build_object('completedAt',c.completed_at,'filledPositions',6,
           'cycleEarnings',COALESCE((SELECT sum(i.credited_amount)::text FROM x4_income_history i WHERE i.owner_cycle_id=c.id),'0'),
           'positionWallets',COALESCE((SELECT jsonb_agg(u.wallet_address ORDER BY xp.slot_number)
             FROM x4_positions xp JOIN users u ON u.id=xp.placed_user_id WHERE xp.owner_cycle_id=c.id),'[]'::jsonb))
       FROM x4_recycle_history r JOIN viewer v ON v.id=r.user_id JOIN x4_cycles c ON c.id=r.completed_cycle_id
       JOIN x4_positions p ON p.id=r.triggering_position_id JOIN package_definitions pd ON pd.serial_number=r.package_id
       UNION ALL
       SELECT 'autopool-income:'||a.id,'AUTOPOOL_INCOME','AUTOPOOL',a.credited_amount::text,'USDT',u.wallet_address,
         NULL,NULL,'AUTOPOOL',NULL,NULL,'CONFIRMED',a.idempotency_key,a.created_at,
         'Autopool income received','GLOBAL_AUTOPOOL',a.matrix_level,p.position_number,
         jsonb_build_object('parentPosition',p.parent_position_number,
           'parentWallet',(SELECT pu.wallet_address FROM autopool_positions parent
             JOIN users pu ON pu.id=parent.placed_user_id
             WHERE parent.owner_entry_id=p.owner_entry_id AND parent.position_number=p.parent_position_number))
       FROM autopool_income_history a JOIN viewer v ON v.id=a.owner_user_id JOIN users u ON u.id=a.source_user_id
       JOIN autopool_positions p ON p.id=a.position_id
       UNION ALL
       SELECT 'autopool-placement:'||p.id,'AUTOPOOL_PLACEMENT','AUTOPOOL',NULL,NULL,u.wallet_address,
         NULL,NULL,'AUTOPOOL',NULL,NULL,'CONFIRMED',p.idempotency_key,p.created_at,
         'Autopool placement completed',NULL,p.matrix_level,p.position_number,
         jsonb_build_object('parentPosition',p.parent_position_number,'childSlot',p.child_slot,
           'parentWallet',(SELECT pu.wallet_address FROM autopool_positions parent
             JOIN users pu ON pu.id=parent.placed_user_id
             WHERE parent.owner_entry_id=p.owner_entry_id AND parent.position_number=p.parent_position_number))
       FROM autopool_positions p JOIN autopool_entries e ON e.id=p.owner_entry_id JOIN viewer v ON v.id=e.owner_user_id
       JOIN users u ON u.id=p.placed_user_id
       UNION ALL
       SELECT 'booster-income:'||b.id,'BOOSTER_INCOME','BOOSTER',b.credited_amount::text,'USDT',u.wallet_address,
         NULL,NULL,'BOOSTER',e.cycle_number,NULL,'CONFIRMED',b.idempotency_key,b.created_at,
         'Booster income received','BOOSTER',NULL,b.slot_number,jsonb_build_object('grossAmount',b.gross_amount)
       FROM booster_income_history b JOIN viewer v ON v.id=b.owner_user_id JOIN users u ON u.id=b.source_user_id
       JOIN booster_entries e ON e.id=b.owner_entry_id
       UNION ALL
       SELECT 'booster-topup:'||b.id,'BOOSTER_TOP_UP','BOOSTER',b.amount_token_units::text,'USDT',b.sender_address,
         NULL,NULL,'BOOSTER',NULL,NULL,b.status,b.tx_hash,b.created_at,'Booster Wallet topped up',
         NULL,NULL,NULL,jsonb_build_object('blockNumber',b.block_number,
           'previousBalance',l.metadata->>'previousBalance','newBalance',l.metadata->>'newBalance')
       FROM booster_top_up_history b JOIN viewer v ON v.id=b.user_id
       LEFT JOIN booster_wallet_ledger l ON l.top_up_id=b.id
       UNION ALL
       SELECT 'booster-run:'||s.id,'BOOSTER_RUN','BOOSTER',NULL,NULL,NULL,NULL,NULL,'BOOSTER',
         e.cycle_number,NULL,s.status,NULL,s.created_at,'Booster run processed',NULL,NULL,e.placement_slot,
         jsonb_build_object('scheduledFor',s.scheduled_for,'nextEligibleAt',bm.next_entry_at,'error',s.error_message)
       FROM booster_scheduler_history s JOIN viewer v ON v.id=s.user_id LEFT JOIN booster_entries e ON e.scheduler_history_id=s.id
       LEFT JOIN booster_memberships bm ON bm.user_id=s.user_id
       UNION ALL
       SELECT 'dividend:'||d.id,'DIVIDEND_INCOME','DIVIDEND',d.amount::text,'USDT',NULL,p.amount_token_units::text,
         p.package_id,NULL,NULL,NULL,'CONFIRMED',d.idempotency_key,d.created_at,'Dividend income credited',
         'DAILY_DIVIDEND',NULL,NULL,jsonb_build_object('businessDate',d.business_date)
       FROM daily_dividend_allocations d JOIN viewer v ON v.id=d.user_id JOIN package_purchases p ON p.id=d.package_purchase_id
       UNION ALL
       SELECT 'withdrawal:'||w.id,'WITHDRAWAL','WITHDRAWALS',w.gross_reserved::text,'USDT',w.payout_address,
         NULL,NULL,NULL,NULL,NULL,w.status,w.tx_hash,w.created_at,
         CASE WHEN w.status='CONFIRMED' THEN 'Withdrawal completed' ELSE 'Withdrawal requested' END,
         NULL,NULL,NULL,jsonb_build_object('fee',w.fee_amount,'netAmount',w.net_payout,'updatedAt',w.updated_at,
           'rejectionReason',(SELECT a.error_message FROM auto_withdrawal_attempts a WHERE a.withdrawal_id=w.id ORDER BY a.attempt_number DESC LIMIT 1))
       FROM auto_withdrawals w JOIN viewer v ON v.id=w.user_id
       UNION ALL
       SELECT 'wallet:'||l.id,'WALLET_'||l.direction,'WALLET',l.amount::text,'USDT',NULL,NULL,NULL,NULL,NULL,NULL,
         CASE WHEN l.direction='CREDIT' THEN 'CONFIRMED' ELSE 'RECORDED' END,NULL,l.created_at,
         'Income Wallet '||lower(l.direction)||' recorded',l.reason,NULL,NULL,l.metadata
       FROM income_wallet_ledger l JOIN viewer v ON v.id=l.user_id
     )
     SELECT * FROM history
     WHERE ($2::text IS NULL OR category=$2)
       AND ($10::text IS NULL OR type=$10 OR ($10='X3' AND type LIKE 'X3_%') OR ($10='X4' AND type LIKE 'X4_%'))
       AND ($3::text IS NULL OR upper(status)=$3)
       AND ($4::text IS NULL OR source_wallet ILIKE '%'||$4||'%' OR tx_hash ILIKE '%'||$4||'%'
         OR package_id::text=$4 OR income_type ILIKE '%'||$4||'%')
       AND ($5::timestamptz IS NULL OR created_at >= $5)
       AND ($6::timestamptz IS NULL OR created_at <= $6)
       AND ($7::timestamptz IS NULL OR (created_at,id) < ($7,$8))
     ORDER BY created_at DESC,id DESC LIMIT $9`,
    values,
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit).map((row: any) => {
    const metadata = { ...(row.metadata || {}) };
    for (const key of ["cycleEarnings","directIncomeGenerated","fee","netAmount","previousBalance","newBalance"]) {
      if (metadata[key] !== undefined && metadata[key] !== null) metadata[key] = usdt(String(metadata[key]));
    }
    return {
      id: row.id, type: row.type, category: row.category, amount: usdt(row.amount),
      currency: row.currency, sourceWallet: row.source_wallet, packageAmount: usdt(row.package_amount),
      packageId: row.package_id, matrixType: row.matrix_type, cycle: row.cycle,
      recycleCount: row.recycle_count, status: row.status, txHash: row.tx_hash,
      createdAt: new Date(row.created_at).toISOString(), description: row.description,
      incomeType: row.income_type, level: row.level, position: row.position, metadata,
    };
  });
  return { items, nextCursor: hasMore ? encodeCursor(result.rows[limit - 1]) : null };
}
