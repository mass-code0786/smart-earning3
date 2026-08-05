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
      `SELECT c.package_id,c.cycle_number,c.id cycle_id,NULL::text matrix_parent,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'slotNumber',s.slot_number,'wallet',u.wallet_address,'recipientWallet',ru.wallet_address,
          'disposition',s.disposition,'grossAmount',s.gross_amount::text,'createdAt',s.created_at
        ) ORDER BY s.slot_number) FROM x3_direct_cycle_slots s JOIN users u ON u.id=s.buyer_user_id
          LEFT JOIN users ru ON ru.id=s.recipient_user_id
          WHERE s.cycle_id=c.id),'[]') slots,
        GREATEST(c.cycle_number-1,0)::int recycle_count
       FROM x3_direct_cycles c WHERE c.owner_user_id=$1 AND c.status='ACTIVE'
       ORDER BY c.package_id`,[id]),
    query<{package_id:number;earned:string;held:string;released:string;flushed:string}>(
      `SELECT p.serial_number package_id,
        COALESCE(sum(i.credited_amount) FILTER(WHERE i.status IN ('WITHDRAWABLE','CAPPED','RELEASED')),0)::text earned,
        COALESCE((SELECT sum(h.amount) FROM x3_hold_ledger h WHERE h.user_id=$1 AND h.package_id=p.serial_number AND h.status='HELD'),0)::text held,
        COALESCE((SELECT sum(h.released_amount) FROM x3_hold_ledger h WHERE h.user_id=$1 AND h.package_id=p.serial_number AND h.status IN('RELEASED','PARTIALLY_CAPPED')),0)::text released,
        COALESCE((SELECT sum(h.amount) FROM x3_hold_ledger h WHERE h.user_id=$1 AND h.package_id=p.serial_number AND h.status='FLUSHED'),0)::text flushed
       FROM package_definitions p LEFT JOIN x3_direct_income_ledger i ON i.recipient_user_id=$1 AND i.package_id=p.serial_number
       GROUP BY p.serial_number ORDER BY p.serial_number`,[id]),
  ]);
  const cycleMap=new Map(cycles.rows.map(x=>[x.package_id,x]));
  const totalMap=new Map(totals.rows.map(x=>[x.package_id,x]));
  return X3_PACKAGE_PRICES.map(item=>{
    const cycle=cycleMap.get(item.packageId),amount=x3Allocation(item.price),total=totalMap.get(item.packageId);
    return{
      packageId:item.packageId,priceTokenUnits:item.price.toString(),x3Allocation:amount.x3.toString(),
      active:Boolean(cycle),permanentSponsor:sponsor.rows[0]?.wallet_address||null,
       matrixParent:null,currentCycle:cycle?.cycle_number||0,
      slots:cycle?.slots||[],earnedIncome:total?.earned||"0",heldIncome:total?.held||"0",
       releasedIncome:total?.released||"0",flushedIncome:total?.flushed||"0",recycleCount:cycle?.recycle_count||0,
    };
  });
}

export async function getX3Summary(wallet:string){
  const packages=await getX3Packages(wallet);
  return{
    totalWithdrawable:packages.reduce((n,p)=>n+BigInt(p.earnedIncome),0n).toString(),
    totalHeld:packages.reduce((n,p)=>n+BigInt(p.heldIncome),0n).toString(),
    totalReleased:packages.reduce((n,p)=>n+BigInt(p.releasedIncome),0n).toString(),
    totalFlushed:packages.reduce((n,p)=>n+BigInt(p.flushedIncome),0n).toString(),
    totalCycles:packages.reduce((n,p)=>n+p.currentCycle,0),
    totalRecycleCount:packages.reduce((n,p)=>n+p.recycleCount,0),packages,
  };
}

export async function getX3Matrix(wallet:string,packageId:number,depth=4){
  if(packageId<1||packageId>8)throw new ApiError(400,"Invalid package","INVALID_PACKAGE");
  const id=await userId(wallet),safeDepth=Math.max(1,Math.min(depth,8));
  const nodes=await query(`SELECT c.id,NULL::uuid parent_cycle_id,c.cycle_number,c.status,0 depth,u.wallet_address,
    COALESCE(s.slot_number,0) slot_number,COALESCE(s.disposition,'OWNER') placement_type,
    bu.wallet_address buyer_wallet,ru.wallet_address recipient_wallet,s.gross_amount::text amount
    FROM x3_direct_cycles c JOIN users u ON u.id=c.owner_user_id
    LEFT JOIN x3_direct_cycle_slots s ON s.cycle_id=c.id LEFT JOIN users bu ON bu.id=s.buyer_user_id
    LEFT JOIN users ru ON ru.id=s.recipient_user_id WHERE c.owner_user_id=$1 AND c.package_id=$2
    ORDER BY c.cycle_number,s.slot_number`,[id,packageId]);
  return{packageId,depth:safeDepth,nodes:nodes.rows};
}

export async function getX3Hold(wallet:string){
  const id=await userId(wallet);
  const result=await query(
    `SELECT h.id,h.package_id,h.amount::text,h.status,h.released_amount::text,h.excess_amount::text,
      h.held_at,h.expires_at,h.released_at,h.flushed_at,u.wallet_address source_wallet,
      COALESCE(i.owner_cycle_id,ds.cycle_id) owner_cycle_id
     FROM x3_hold_ledger h LEFT JOIN x3_income_ledger i ON i.id=h.x3_income_ledger_id
     LEFT JOIN x3_direct_income_ledger di ON di.id=h.x3_direct_income_ledger_id
     LEFT JOIN x3_direct_cycle_slots ds ON ds.id=di.slot_id
     JOIN users u ON u.id=COALESCE(i.source_user_id,ds.buyer_user_id)
     WHERE h.user_id=$1 ORDER BY h.held_at DESC`,[id],
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
       SELECT CASE s.disposition WHEN 'OWNER_INCOME' THEN 'OWNER_INCOME' WHEN 'PASS_UP' THEN 'PASS_UP_INCOME' ELSE 'GENESIS_RETAINED' END type,
         c.package_id,s.disposition status,s.gross_amount amount,s.created_at,s.cycle_id,c.owner_user_id actor_user_id,s.id reference_id
       FROM x3_direct_cycle_slots s JOIN x3_direct_cycles c ON c.id=s.cycle_id
       UNION ALL
       SELECT CASE h.status WHEN 'HELD' THEN 'HOLD' WHEN 'FLUSHED' THEN 'FLUSH' ELSE 'RELEASE' END,
         h.package_id,h.status,h.amount,h.held_at,s.cycle_id,h.user_id,h.id
       FROM x3_hold_ledger h JOIN x3_direct_income_ledger i ON i.id=h.x3_direct_income_ledger_id
       JOIN x3_direct_cycle_slots s ON s.id=i.slot_id
       UNION ALL
       SELECT 'CYCLE_COMPLETED',c.package_id,c.status,0,c.completed_at,c.id,c.owner_user_id,c.id
       FROM x3_direct_cycles c WHERE c.status='COMPLETED'
     )
     SELECT h.type,h.package_id,h.status,h.amount::text,h.created_at,h.cycle_id,h.reference_id,
       c.cycle_number
      FROM history h LEFT JOIN x3_direct_cycles c ON c.id=h.cycle_id
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
