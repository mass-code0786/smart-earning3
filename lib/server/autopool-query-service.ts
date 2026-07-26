import{normalizeWallet}from"./auth";import{query}from"./db";import{ApiError}from"./http";
async function userId(wallet:string){const row=(await query<{id:string}>("SELECT id FROM users WHERE wallet_address=$1",[normalizeWallet(wallet)])).rows[0];if(!row)throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");return row.id}
export async function getAutopoolDashboard(wallet:string){
 const id=await userId(wallet);
 const[stats,entries,history]=await Promise.all([
  query(`SELECT count(*)::int total_entries,count(*) FILTER(WHERE status='ACTIVE')::int active_entries,
   count(*) FILTER(WHERE status='COMPLETED')::int completed_entries,COALESCE(sum(filled_positions),0)::int filled_positions,
   COALESCE(sum(242-filled_positions) FILTER(WHERE status='ACTIVE'),0)::int remaining_positions,
   COALESCE((SELECT sum(credited_amount) FROM autopool_income_history WHERE owner_user_id=$1),0)::text total_income
   FROM autopool_entries WHERE owner_user_id=$1`,[id]),
  query(`SELECT e.id,e.booster_entry_id,e.status,e.filled_positions,(242-e.filled_positions)::int remaining_positions,e.created_at,e.completed_at,
   COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'level')::int) FROM (SELECT jsonb_build_object('level',l.level,'capacity',l.capacity,
    'filled',count(p.id),'income',COALESCE(sum(i.credited_amount),0)::text) x FROM (VALUES(1,2),(2,6),(3,18),(4,54),(5,162)) l(level,capacity)
    LEFT JOIN autopool_positions p ON p.owner_entry_id=e.id AND p.matrix_level=l.level
    LEFT JOIN autopool_income_history i ON i.position_id=p.id GROUP BY l.level,l.capacity) levels),'[]') levels,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('position',p.position_number,'level',p.matrix_level,'levelPosition',p.level_position,
    'parentPosition',p.parent_position_number,'childSlot',p.child_slot,'wallet',u.wallet_address) ORDER BY p.position_number)
    FROM autopool_positions p JOIN users u ON u.id=p.placed_user_id WHERE p.owner_entry_id=e.id),'[]') positions
   FROM autopool_entries e WHERE e.owner_user_id=$1 ORDER BY e.created_at DESC`,[id]),
  query(`SELECT i.id,i.owner_entry_id entry_id,i.matrix_level,i.gross_amount::text gross_amount,i.credited_amount::text amount,
   i.excess_amount::text excess_amount,u.wallet_address source_wallet,i.created_at FROM autopool_income_history i
   JOIN users u ON u.id=i.source_user_id WHERE i.owner_user_id=$1 ORDER BY i.created_at DESC LIMIT 500`,[id])
 ]);
 return{...stats.rows[0],entries:entries.rows,history:history.rows};
}
export async function getAdminAutopoolReport(kind:string,filters:URLSearchParams){
 const q=filters.get("q")||null;
 if(kind==="summary"||kind==="statistics")return(await query(`SELECT
  (SELECT count(*)::int FROM autopool_entries) total_entries,
  (SELECT count(*)::int FROM autopool_entries WHERE status='ACTIVE') active_entries,
  (SELECT count(*)::int FROM autopool_entries WHERE status='COMPLETED') completed_entries,
  (SELECT count(*)::int FROM autopool_positions) placements,
  (SELECT count(*)::int FROM autopool_global_queue) queue_size,
  (SELECT COALESCE(sum(gross_amount),0)::text FROM autopool_income_history) gross_income,
  (SELECT COALESCE(sum(credited_amount),0)::text FROM autopool_income_history) credited_income,
  (SELECT COALESCE(sum(excess_amount),0)::text FROM autopool_income_history) capped_excess`)).rows[0];
 const map:Record<string,{table:string;user:string;order:string;where?:string}>={
  entries:{table:"autopool_entries",user:"owner_user_id",order:"created_at"},active:{table:"autopool_entries",user:"owner_user_id",order:"created_at",where:"t.status='ACTIVE'"},
  completed:{table:"autopool_entries",user:"owner_user_id",order:"completed_at",where:"t.status='COMPLETED'"},
  queue:{table:"autopool_global_queue",user:"(SELECT owner_user_id FROM autopool_entries e WHERE e.id=t.entry_id)",order:"queue_sequence"},
  placements:{table:"autopool_positions",user:"placed_user_id",order:"created_at"},income:{table:"autopool_income_history",user:"owner_user_id",order:"created_at"},
  audit:{table:"autopool_audit_logs",user:"user_id",order:"created_at"}};
 const spec=map[kind];if(!spec)throw new ApiError(404,"Unknown Autopool report","REPORT_NOT_FOUND");
 return{items:(await query(`SELECT t.*,u.wallet_address FROM ${spec.table} t LEFT JOIN users u ON u.id=${spec.user}
  WHERE (${spec.where||"TRUE"}) AND ($1::text IS NULL OR to_jsonb(t)::text ILIKE '%'||$1||'%' OR u.wallet_address ILIKE '%'||$1||'%')
  ORDER BY t.${spec.order} DESC NULLS LAST LIMIT 300`,[q])).rows};
}
