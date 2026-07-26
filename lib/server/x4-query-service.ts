import{normalizeWallet}from"./auth";
import{query}from"./db";
import{ApiError}from"./http";
import{X4_PACKAGE_PRICES}from"./x4-math";

async function indexedUser(walletInput:string){
  const wallet=normalizeWallet(walletInput);
  const user=await query<{id:string}>("SELECT id FROM users WHERE wallet_address=$1",[wallet]);
  if(!user.rows[0])throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");
  return user.rows[0].id;
}

export async function getX4Packages(wallet:string){
  const userId=await indexedUser(wallet);
  const [cycles,totals,history]=await Promise.all([
    query<{
      package_id:number;id:string;cycle_number:number;status:string;recycle_count:number;
      slots:{slotNumber:number;level:number;wallet:string;placementType:string;createdAt:string}[];
    }>(
      `SELECT c.package_id,c.id,c.cycle_number,c.status,
        (SELECT count(*)::int FROM x4_recycle_history r WHERE r.user_id=c.user_id AND r.package_id=c.package_id) recycle_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'slotNumber',p.slot_number,'level',p.level_number,'wallet',u.wallet_address,
          'placementType',p.placement_type,'createdAt',p.created_at
        ) ORDER BY p.slot_number) FROM x4_positions p JOIN users u ON u.id=p.placed_user_id
          WHERE p.owner_cycle_id=c.id),'[]') slots
       FROM x4_cycles c WHERE c.user_id=$1 AND c.status='ACTIVE'
       AND c.cycle_number=(SELECT max(x.cycle_number) FROM x4_cycles x WHERE x.user_id=c.user_id AND x.package_id=c.package_id)
       ORDER BY c.package_id`,[userId]),
    query<{package_id:number;magic_income:string;level2_income:string;level2_excess:string}>(
      `SELECT d.serial_number package_id,
        COALESCE(sum(i.credited_amount) FILTER(WHERE i.level_number=1),0)::text magic_income,
        COALESCE(sum(i.credited_amount) FILTER(WHERE i.level_number=2),0)::text level2_income,
        COALESCE(sum(i.excess_amount) FILTER(WHERE i.level_number=2),0)::text level2_excess
       FROM package_definitions d LEFT JOIN x4_income_history i
         ON i.package_id=d.serial_number AND i.owner_user_id=$1
       GROUP BY d.serial_number ORDER BY d.serial_number`,[userId]),
    query(
      `SELECT h.id,'INCOME' type,h.package_id,h.level_number level,h.wallet_type status,
        h.credited_amount::text amount,h.created_at,h.owner_cycle_id cycle_id
       FROM x4_income_history h WHERE h.owner_user_id=$1
       UNION ALL
       SELECT r.id,'RECYCLE',r.package_id,NULL,'COMPLETED','0',r.created_at,r.completed_cycle_id
       FROM x4_recycle_history r WHERE r.user_id=$1
       UNION ALL
       SELECT p.id,'PLACEMENT',p.package_id,p.level_number,p.placement_type,'0',p.created_at,p.owner_cycle_id
       FROM x4_positions p WHERE p.placed_user_id=$1
       ORDER BY created_at DESC LIMIT 200`,[userId]),
  ]);
  const cycleMap=new Map(cycles.rows.map(row=>[row.package_id,row]));
  const totalMap=new Map(totals.rows.map(row=>[row.package_id,row]));
  return{
    packages:X4_PACKAGE_PRICES.map(item=>{
      const cycle=cycleMap.get(item.packageId),total=totalMap.get(item.packageId);
      const magic=total?.magic_income||"0",level2=total?.level2_income||"0";
      return{packageId:item.packageId,priceTokenUnits:item.price.toString(),active:Boolean(cycle),
        currentCycle:cycle?.cycle_number||0,cycleStatus:cycle?.status||"INACTIVE",
        slots:cycle?.slots||[],filledPositions:cycle?.slots.length||0,emptyPositions:6-(cycle?.slots.length||0),
        recycleCount:cycle?.recycle_count||0,magicLevelIncome:magic,level2Income:level2,
        cappedExcess:total?.level2_excess||"0",totalEarnings:(BigInt(magic)+BigInt(level2)).toString()};
    }),history:history.rows,
  };
}

export async function getAdminX4Report(kind:string,filters:URLSearchParams){
  const packageId=Number(filters.get("package")||0)||null;
  const search=filters.get("q")?.trim()||null;
  if(kind==="summary"){
    const summary=await query(`SELECT
      (SELECT count(*)::int FROM x4_package_memberships) memberships,
      (SELECT count(*)::int FROM x4_cycles WHERE status='ACTIVE') active_cycles,
      (SELECT count(*)::int FROM x4_cycles WHERE status='COMPLETED') completed_cycles,
      (SELECT count(*)::int FROM x4_positions) placements,
      (SELECT count(*)::int FROM x4_recycle_history) recycles,
      (SELECT COALESCE(sum(credited_amount),0)::text FROM x4_income_history WHERE level_number=1) magic_income,
      (SELECT COALESCE(sum(credited_amount),0)::text FROM x4_income_history WHERE level_number=2) level2_income,
      (SELECT COALESCE(sum(excess_amount),0)::text FROM x4_income_history) capped_excess`);
    return summary.rows[0];
  }
  const tables:Record<string,string>={
    cycles:"x4_cycles",queues:"x4_queue",placements:"x4_positions",
    recycles:"x4_recycle_history",income:"x4_income_history",audit:"x4_audit_logs",
  };
  const table=tables[kind];
  if(!table)throw new ApiError(404,"Unknown X4 report","REPORT_NOT_FOUND");
  const userExpression=kind==="income"?"t.owner_user_id"
    :kind==="queues"?"(SELECT c.user_id FROM x4_cycles c WHERE c.id=t.cycle_id)"
    :kind==="placements"?"t.placed_user_id":"t.user_id";
  const orderExpression=kind==="queues"?"t.queue_sequence"
    :kind==="cycles"?"t.opened_at":"t.created_at";
  const result=await query(
    `SELECT t.*,u.wallet_address FROM ${table} t
     LEFT JOIN users u ON u.id=${userExpression}
     WHERE ($1::smallint IS NULL OR t.package_id=$1)
       AND ($2::text IS NULL OR to_jsonb(t)::text ILIKE '%'||$2||'%' OR u.wallet_address ILIKE '%'||$2||'%')
     ORDER BY ${orderExpression} DESC LIMIT 200`,
    [packageId,search],
  );
  return{items:result.rows};
}
