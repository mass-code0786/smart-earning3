import { query } from "./db";
import { normalizeWallet } from "./auth";
import { ApiError } from "./http";
import { X3_PACKAGE_PRICES, x3Allocation } from "./x3-math";
import { getRecoveryPolicy } from "./x3-recovery-policy";

async function userId(walletInput:string){
  const wallet=normalizeWallet(walletInput);
  const result=await query<{id:string}>(
    "SELECT id FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'",
    [wallet],
  );
  if(!result.rows[0])throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");
  return result.rows[0].id;
}

export async function getX3Packages(wallet:string){
  const id=await userId(wallet);
  const [sponsor,cycles,totals]=await Promise.all([
    query<{wallet_address:string}>(
      `SELECT s.wallet_address FROM referral_relations r JOIN users s ON s.id=r.sponsor_user_id
       WHERE r.user_id=$1`,[id]),
    query<{
      package_id:number;cycle_number:number;cycle_id:string;matrix_parent:string|null;
      slots:{slotNumber:number;wallet:string;placementType:string}[];recycle_count:number;
    }>(
      `SELECT c.package_id,c.cycle_number,c.id cycle_id,mp.wallet_address matrix_parent,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'slotNumber',s.slot_number,'wallet',u.wallet_address,'placementType',s.placement_type
        ) ORDER BY s.slot_number) FROM x3_cycle_slots s JOIN users u ON u.id=s.placed_user_id
          WHERE s.cycle_id=c.id),'[]') slots,
        (SELECT count(*)::int FROM x3_recycle_events r WHERE r.user_id=c.user_id AND r.package_id=c.package_id) recycle_count
       FROM x3_cycles c LEFT JOIN users mp ON mp.id=c.matrix_parent_user_id
       WHERE c.user_id=$1 AND c.status='ACTIVE'
       AND c.cycle_number=(SELECT max(c2.cycle_number) FROM x3_cycles c2 WHERE c2.user_id=c.user_id AND c2.package_id=c.package_id)
       ORDER BY c.package_id`,[id]),
    query<{package_id:number;earned:string;held:string;released:string}>(
      `SELECT p.serial_number package_id,
        COALESCE(sum(i.credited_amount) FILTER(WHERE i.status IN ('WITHDRAWABLE','CAPPED')),0)::text earned,
        COALESCE((SELECT sum(h.amount) FROM x3_hold_ledger h WHERE h.user_id=$1 AND h.package_id=p.serial_number AND h.status='HELD'),0)::text held,
        COALESCE((SELECT sum(h.released_amount) FROM x3_hold_ledger h WHERE h.user_id=$1 AND h.package_id=p.serial_number AND h.status<>'HELD'),0)::text released
       FROM package_definitions p LEFT JOIN x3_income_ledger i ON i.owner_user_id=$1 AND i.package_id=p.serial_number
       GROUP BY p.serial_number ORDER BY p.serial_number`,[id]),
  ]);
  const cycleMap=new Map(cycles.rows.map(x=>[x.package_id,x]));
  const totalMap=new Map(totals.rows.map(x=>[x.package_id,x]));
  return X3_PACKAGE_PRICES.map(item=>{
    const cycle=cycleMap.get(item.packageId),amount=x3Allocation(item.price),total=totalMap.get(item.packageId);
    return{
      packageId:item.packageId,priceTokenUnits:item.price.toString(),x3Allocation:amount.x3.toString(),
      active:Boolean(cycle),permanentSponsor:sponsor.rows[0]?.wallet_address||null,
      matrixParent:cycle?.matrix_parent||null,currentCycle:cycle?.cycle_number||0,
      slots:cycle?.slots||[],earnedIncome:total?.earned||"0",heldIncome:total?.held||"0",
      releasedIncome:total?.released||"0",recycleCount:cycle?.recycle_count||0,
    };
  });
}

export async function getX3Summary(wallet:string){
  const packages=await getX3Packages(wallet);
  return{
    totalWithdrawable:packages.reduce((n,p)=>n+BigInt(p.earnedIncome),0n).toString(),
    totalHeld:packages.reduce((n,p)=>n+BigInt(p.heldIncome),0n).toString(),
    totalReleased:packages.reduce((n,p)=>n+BigInt(p.releasedIncome),0n).toString(),
    totalCycles:packages.reduce((n,p)=>n+p.currentCycle,0),
    totalRecycleCount:packages.reduce((n,p)=>n+p.recycleCount,0),packages,
  };
}

export async function getX3Matrix(wallet:string,packageId:number,depth=4){
  if(packageId<1||packageId>8)throw new ApiError(400,"Invalid package","INVALID_PACKAGE");
  const id=await userId(wallet),safeDepth=Math.max(1,Math.min(depth,8));
  const anchor=await query<{id:string}>(
    "SELECT id FROM x3_cycles WHERE user_id=$1 AND package_id=$2 AND cycle_number=1",[id,packageId],
  );
  if(!anchor.rows[0])return{packageId,nodes:[]};
  const nodes=await query(
    `WITH RECURSIVE tree AS (
       SELECT c.id,c.user_id,c.parent_cycle_id,c.cycle_number,c.status,0 depth
       FROM x3_cycles c WHERE c.id=$1
       UNION ALL
       SELECT child.id,child.user_id,child.parent_cycle_id,child.cycle_number,child.status,t.depth+1
       FROM tree t JOIN x3_cycle_slots s ON s.cycle_id=t.id
       JOIN x3_cycles child ON child.id=s.placed_user_cycle_id WHERE t.depth<$2
     )
     SELECT t.id,t.parent_cycle_id,t.cycle_number,t.status,t.depth,u.wallet_address,
       COALESCE(s.slot_number,0) slot_number,COALESCE(s.placement_type,'ROOT') placement_type
     FROM tree t JOIN users u ON u.id=t.user_id
     LEFT JOIN x3_cycle_slots s ON s.placed_user_cycle_id=t.id ORDER BY t.depth,t.parent_cycle_id,s.slot_number`,
    [anchor.rows[0].id,safeDepth],
  );
  return{packageId,depth:safeDepth,nodes:nodes.rows};
}

export async function getX3Hold(wallet:string){
  const id=await userId(wallet);
  const result=await query(
    `SELECT h.id,h.package_id,h.amount::text,h.status,h.released_amount::text,h.excess_amount::text,
      h.held_at,h.released_at,u.wallet_address source_wallet,i.owner_cycle_id
     FROM x3_hold_ledger h JOIN x3_income_ledger i ON i.id=h.x3_income_ledger_id
     JOIN users u ON u.id=i.source_user_id WHERE h.user_id=$1 ORDER BY h.held_at DESC`,[id],
  );
  return{entries:result.rows};
}

export async function getX3History(wallet:string,filters:URLSearchParams){
  const id=await userId(wallet),packageId=Number(filters.get("package")||0)||null;
  const page=Math.max(1,Number(filters.get("page")||1)),limit=25;
  const type=filters.get("type")||null,status=filters.get("status")||null;
  const cycle=Number(filters.get("cycle")||0)||null;
  const from=filters.get("from")||null,to=filters.get("to")||null;
  const result=await query(
    `WITH history AS (
       SELECT CASE WHEN e.placement_type='SPILLOVER' THEN 'SPILLOVER' ELSE 'PLACEMENT' END type,
         e.package_id,e.placement_type status,e.carried_allocation_amount amount,e.created_at,
         e.cycle_id,e.placed_user_id actor_user_id,e.id reference_id
       FROM x3_placement_events e
       UNION ALL
       SELECT CASE WHEN i.status='RECYCLE' THEN 'RECYCLE' ELSE 'SLOT_INCOME' END,
         i.package_id,i.status,i.gross_amount,i.created_at,i.owner_cycle_id,i.owner_user_id,i.id
       FROM x3_income_ledger i
       UNION ALL
       SELECT CASE WHEN h.status='HELD' THEN 'HOLD' ELSE 'RELEASE' END,
         h.package_id,h.status,h.amount,h.held_at,i.owner_cycle_id,h.user_id,h.id
       FROM x3_hold_ledger h JOIN x3_income_ledger i ON i.id=h.x3_income_ledger_id
       UNION ALL
       SELECT 'CYCLE_COMPLETED',c.package_id,c.status,0,c.completed_at,c.id,c.user_id,c.id
       FROM x3_cycles c WHERE c.status='COMPLETED'
       UNION ALL
       SELECT 'CAPPED_EXCESS',i.package_id,x.status,x.excess_amount,x.created_at,
         i.owner_cycle_id,x.user_id,x.id
       FROM capped_excess_ledger x JOIN x3_income_ledger i
         ON x.source_reference=i.slot_id::text
       WHERE x.income_type='X3_PACKAGE'
       UNION ALL
       SELECT 'CAPPED_EXCESS',i.package_id,x.status,x.excess_amount,x.created_at,
         i.owner_cycle_id,x.user_id,x.id
       FROM capped_excess_ledger x JOIN x3_hold_ledger h ON x.source_reference=h.id::text
       JOIN x3_income_ledger i ON i.id=h.x3_income_ledger_id
       WHERE x.income_type='X3_HOLD_RELEASE'
       UNION ALL
       SELECT p.status,p.package_id,p.status,p.carried_allocation_amount,p.created_at,
         p.completed_cycle_id,p.root_user_id,p.id FROM x3_pending_allocations p
     )
     SELECT h.type,h.package_id,h.status,h.amount::text,h.created_at,h.cycle_id,h.reference_id,
       c.cycle_number
     FROM history h LEFT JOIN x3_cycles c ON c.id=h.cycle_id
     WHERE h.actor_user_id=$1 AND ($2::smallint IS NULL OR h.package_id=$2)
       AND ($3::text IS NULL OR h.type=$3) AND ($4::text IS NULL OR h.status=$4)
       AND ($5::date IS NULL OR h.created_at >= $5::date)
       AND ($6::date IS NULL OR h.created_at < $6::date + interval '1 day')
       AND ($7::int IS NULL OR c.cycle_number=$7)
     ORDER BY h.created_at DESC LIMIT $8 OFFSET $9`,
    [id,packageId,type,status,from,to,cycle,limit,(page-1)*limit],
  );
  return{page,items:result.rows};
}

export async function getAdminX3Report(kind:string,filters:URLSearchParams){
  const packageId=Number(filters.get("package")||0)||null;
  if(kind==="summary"){
    const result=await query(`SELECT
      (SELECT count(*)::int FROM x3_package_memberships) active_memberships,
      (SELECT count(*)::int FROM x3_cycle_slots) total_placements,
      (SELECT count(*)::int FROM x3_cycle_slots WHERE placement_type='DIRECT') direct_placements,
      (SELECT count(*)::int FROM x3_cycle_slots WHERE placement_type='SPILLOVER') spillover_placements,
      (SELECT count(*)::int FROM x3_cycles WHERE status='ACTIVE') active_cycles,
      (SELECT count(*)::int FROM x3_cycles WHERE status='COMPLETED') completed_cycles,
      (SELECT count(*)::int FROM x3_recycle_events) recycle_count,
      (SELECT COALESCE(sum(credited_amount),0)::text FROM x3_income_ledger) withdrawable_income,
      (SELECT COALESCE(sum(amount),0)::text FROM x3_hold_ledger WHERE status='HELD') held_income,
      (SELECT COALESCE(sum(released_amount),0)::text FROM x3_hold_ledger) released_income,
      (SELECT COALESCE(sum(excess_amount),0)::text FROM x3_income_ledger) capped_excess,
      (SELECT count(*)::int FROM x3_pending_allocations p LEFT JOIN x3_pending_resolutions r
        ON r.pending_allocation_id=p.id WHERE r.id IS NULL) pending_allocations,
      (SELECT count(*)::int FROM x3_pending_allocations p LEFT JOIN x3_pending_resolutions r
        ON r.pending_allocation_id=p.id WHERE r.id IS NULL AND p.status='ROOT_PENDING') root_pending,
      (SELECT count(*)::int FROM x3_pending_resolutions) recovered_allocations,
      (SELECT count(*)::int FROM x3_recovery_attempts WHERE status='FAILED') failed_recoveries,
      (SELECT count(*)::int FROM x3_recovery_attempts) retry_count,
      (SELECT COALESCE(avg(duration_ms),0)::numeric(12,2)::text FROM x3_recovery_attempts) average_recovery_ms,
      (SELECT count(*)::int FROM x3_recovery_schedule WHERE recovery_state='RETRY_SCHEDULED') retry_scheduled,
      (SELECT count(*)::int FROM x3_recovery_schedule WHERE recovery_state='MANUAL_REVIEW') manual_review,
      (SELECT count(*)::int FROM x3_recovery_schedule WHERE recovery_state='PAUSED') paused_recovery,
      (SELECT COALESCE(max(EXTRACT(epoch FROM now()-p.created_at)),0)::bigint::text
       FROM x3_pending_allocations p JOIN x3_recovery_schedule s ON s.pending_allocation_id=p.id
       WHERE s.recovery_state<>'RECOVERED') oldest_unresolved_seconds,
      (SELECT COALESCE(jsonb_object_agg(trigger_type,total),'{}') FROM (
        SELECT trigger_type,count(*)::int total FROM x3_recovery_attempts
        WHERE status='RECOVERED' GROUP BY trigger_type
      ) q) recoveries_by_trigger,
      (SELECT COALESCE(jsonb_object_agg(terminal_result,total),'{}') FROM (
        SELECT COALESCE(terminal_result,'NONE') terminal_result,count(*)::int total
        FROM x3_recovery_attempts WHERE status='RECOVERED' GROUP BY terminal_result
      ) q) recoveries_by_terminal,
      (SELECT COALESCE(jsonb_object_agg(error_classification,total),'{}') FROM (
        SELECT COALESCE(error_classification,'UNCLASSIFIED') error_classification,count(*)::int total
        FROM x3_recovery_attempts WHERE status='FAILED' GROUP BY error_classification
      ) q) failures_by_classification,
      (SELECT count(*)::int FROM x3_recovery_schedule
       WHERE recovery_state='MANUAL_REVIEW' AND failure_count >= $1) exceeded_retry_limit`,
      [getRecoveryPolicy().maxAutomaticAttempts]);
    return result.rows[0];
  }
  const tables:Record<string,string>={cycles:"x3_cycles",placements:"x3_placement_events",income:"x3_income_ledger",holds:"x3_hold_ledger",releases:"x3_hold_ledger",recycles:"x3_recycle_events",pending:"x3_pending_allocations"};
  const table=tables[kind];if(!table)throw new ApiError(404,"Unknown X3 report","REPORT_NOT_FOUND");
  const search=filters.get("q")||null,from=filters.get("from")||null,to=filters.get("to")||null;
  if(kind==="pending"){
    const result=await query(
      `SELECT p.*,s.failure_count,s.next_attempt_at,s.last_attempt_at,s.last_error_code,
       s.last_error_message,s.recovery_state,s.manually_paused_at,s.permanently_failed_at,s.updated_at
       FROM x3_pending_allocations p JOIN x3_recovery_schedule s ON s.pending_allocation_id=p.id
       WHERE ($1::smallint IS NULL OR p.package_id=$1)
       AND ($2::text IS NULL OR to_jsonb(p)::text ILIKE '%'||$2||'%')
       AND ($3::date IS NULL OR p.created_at >= $3::date)
       AND ($4::date IS NULL OR p.created_at < $4::date + interval '1 day')
       ORDER BY CASE s.recovery_state WHEN 'MANUAL_REVIEW' THEN 0 WHEN 'RETRY_SCHEDULED' THEN 1 ELSE 2 END,
       s.next_attempt_at,p.created_at LIMIT 100`,[packageId,search,from,to],
    );
    return{items:result.rows};
  }
  const result=await query(
    `SELECT * FROM ${table} WHERE ($1::smallint IS NULL OR package_id=$1)
     ${kind==="releases"?"AND status<>'HELD'":""}
     AND ($2::text IS NULL OR to_jsonb(${table})::text ILIKE '%'||$2||'%')
     AND ($3::date IS NULL OR created_at >= $3::date)
     AND ($4::date IS NULL OR created_at < $4::date + interval '1 day')
     ORDER BY created_at DESC LIMIT 100`,[packageId,search,from,to],
  );
  return{items:result.rows};
}
