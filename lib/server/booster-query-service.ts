import{normalizeWallet}from"./auth";import{query}from"./db";import{ApiError}from"./http";
async function user(wallet:string){const r=await query<{id:string}>("SELECT id FROM users WHERE wallet_address=$1",[normalizeWallet(wallet)]);
if(!r.rows[0])throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");return r.rows[0].id}
export async function getBoosterDashboard(wallet:string){
 const id=await user(wallet);
 const serverTime=new Date();
 const[totals,member,entries,walletHistory,entryHistory,topUpHistory]=await Promise.all([
  query(`SELECT
   COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text balance,
   COALESCE(sum(amount_token_units) FILTER(WHERE reason='PACKAGE_CREDIT'),0)::text package_credits,
   COALESCE(sum(amount_token_units) FILTER(WHERE reason='MANUAL_TOP_UP'),0)::text manual_top_ups,
   COALESCE(sum(amount_token_units) FILTER(WHERE reason='C_POSITION_REFUND'),0)::text refunds,
   COALESCE(sum(amount_token_units) FILTER(WHERE reason='ENTRY_DEDUCTION'),0)::text deductions
   FROM booster_wallet_ledger WHERE user_id=$1`,[id]),
  query<{next_entry_at:string|null}>("SELECT next_entry_at FROM booster_memberships WHERE user_id=$1",[id]),
  query(`SELECT e.id,e.cycle_number,e.status,e.created_at,e.completed_at,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('slotNumber',p.slot_number,'wallet',u.wallet_address)
    ORDER BY p.slot_number) FROM booster_positions p JOIN users u ON u.id=p.placed_user_id WHERE p.owner_entry_id=e.id),'[]') positions
   FROM booster_entries e WHERE e.owner_user_id=$1 ORDER BY e.cycle_number DESC`,[id]),
  query(`SELECT id,direction,amount_token_units::text amount,reason,created_at,metadata
   FROM booster_wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 300`,[id]),
  query(`SELECT i.id,'INCOME' type,i.slot_number,i.credited_amount::text amount,i.created_at,i.owner_entry_id entry_id
   FROM booster_income_history i WHERE i.owner_user_id=$1 UNION ALL
   SELECT p.id,'PLACEMENT',p.slot_number,'0',p.created_at,p.owner_entry_id FROM booster_positions p
   WHERE p.placed_user_id=$1 ORDER BY created_at DESC LIMIT 300`,[id]),
  query(`SELECT id,amount_token_units::text amount,source_reference,tx_hash,status,created_at
    FROM booster_top_up_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]),
 ]);
 const stats=await query(`SELECT count(*)::int total_entries,count(*) FILTER(WHERE status='ACTIVE')::int active_entries,
  count(*) FILTER(WHERE status='COMPLETED')::int completed_entries,
  COALESCE((SELECT sum(credited_amount) FROM booster_income_history WHERE owner_user_id=$1),0)::text total_income,
  COALESCE((SELECT sum(3-q.filled) FROM (
    SELECT e2.id,count(p.id)::int filled FROM booster_entries e2
    LEFT JOIN booster_positions p ON p.owner_entry_id=e2.id
    WHERE e2.owner_user_id=$1 AND e2.status='ACTIVE' GROUP BY e2.id
  ) q),0)::int pending_positions
  FROM booster_entries e WHERE owner_user_id=$1`,[id]);
 const balance=BigInt(String(totals.rows[0]?.balance||"0"));
 const nextEntryAt=member.rows[0]?.next_entry_at||null;
 const eligibility=balance<2_500_000n?"INSUFFICIENT_BALANCE"
  :!nextEntryAt?"ERROR":new Date(nextEntryAt).getTime()<=serverTime.getTime()?"DUE":"NOT_DUE";
 return{...totals.rows[0],...stats.rows[0],nextEntryAt,
  server_time:serverTime.toISOString(),next_entry_at:nextEntryAt,
  booster_wallet_balance:balance.toString(),eligibility,status:eligibility,
  entries:entries.rows,walletHistory:walletHistory.rows,entryHistory:entryHistory.rows,
  topUpHistory:topUpHistory.rows};
}
export async function getAdminBoosterReport(kind:string,filters:URLSearchParams){
 const q=filters.get("q")||null;
 if(kind==="summary")return(await query(`SELECT
  (SELECT count(*)::int FROM booster_memberships) users,
  (SELECT count(*)::int FROM booster_entries WHERE status='ACTIVE') active_entries,
  (SELECT count(*)::int FROM booster_entries WHERE status='COMPLETED') completed_entries,
  (SELECT count(*)::int FROM booster_positions) placements,
  (SELECT COALESCE(sum(credited_amount),0)::text FROM booster_income_history) income,
  (SELECT COALESCE(sum(amount_token_units),0)::text FROM booster_wallet_ledger WHERE reason='PACKAGE_CREDIT') package_credits,
  (SELECT COALESCE(sum(amount_token_units),0)::text FROM booster_wallet_ledger WHERE reason='MANUAL_TOP_UP') manual_top_ups,
  (SELECT COALESCE(sum(amount_token_units),0)::text FROM booster_wallet_ledger WHERE reason='C_POSITION_REFUND') refunds,
  (SELECT count(*)::int FROM booster_scheduler_history WHERE status='FAILED') failed`)).rows[0];
 const map:Record<string,{table:string;user:string;order:string}>={wallet:{table:"booster_wallet_ledger",user:"user_id",order:"created_at"},
  topups:{table:"booster_top_up_history",user:"user_id",order:"created_at"},entries:{table:"booster_entries",user:"owner_user_id",order:"created_at"},
  queue:{table:"booster_global_queue",user:"(SELECT owner_user_id FROM booster_entries e WHERE e.id=t.entry_id)",order:"queue_sequence"},
  positions:{table:"booster_positions",user:"placed_user_id",order:"created_at"},income:{table:"booster_income_history",user:"owner_user_id",order:"created_at"},
  scheduler:{table:"booster_scheduler_history",user:"user_id",order:"created_at"},audit:{table:"booster_audit_logs",user:"user_id",order:"created_at"}};
 const spec=map[kind];if(!spec)throw new ApiError(404,"Unknown Booster report","REPORT_NOT_FOUND");
 return{items:(await query(`SELECT t.*,u.wallet_address FROM ${spec.table} t LEFT JOIN users u ON u.id=${spec.user}
  WHERE $1::text IS NULL OR to_jsonb(t)::text ILIKE '%'||$1||'%' OR u.wallet_address ILIKE '%'||$1||'%'
  ORDER BY t.${spec.order} DESC LIMIT 200`,[q])).rows};
}
