import type { PoolClient } from "pg";
import { ApiError } from "./http";
import { creditGrossEarning } from "./earning-split-service";
import { x3Allocation, X3_PACKAGE_PRICES } from "./x3-math";
import { assertModuleActive } from "./module-control-service";
import { flushLockedX3Hold, isX3HoldReleaseEligible } from "./x3-hold-expiry-service";
import { isDirectX3Purchase, processDirectX3PackagePurchase } from "./x3-direct-service";

type PurchaseInput = {
  purchaseId:string; userId:string; packageId:number; amount:bigint;
  txHash:string; blockNumber:number;sourceEventId:string|null;upgradeTimestamp:Date;logIndex?:number;
};
type Cycle = {id:string;user_id:string;cycle_number:number;sponsor_user_id:string};

export async function processX3PackagePurchase(client:PoolClient,input:PurchaseInput){
  await assertModuleActive("X3_PLACEMENT",client);
  const expected=X3_PACKAGE_PRICES[input.packageId-1];
  if(!expected||expected.price!==input.amount)throw new ApiError(422,"X3 package amount mismatch","X3_AMOUNT_MISMATCH");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`x3:package:${input.packageId}`]);
  const done=await client.query("SELECT id FROM x3_package_memberships WHERE activation_purchase_id=$1",[input.purchaseId]);
  if(done.rows[0])return{duplicate:true,membershipId:done.rows[0].id};

  const sponsor=await sponsorOf(client,input.userId);
  const membership=await client.query<{id:string}>(
    `INSERT INTO x3_package_memberships(user_id,package_id,activation_purchase_id,activated_at)
     VALUES($1,$2,$3,now()) RETURNING id`,
    [input.userId,input.packageId,input.purchaseId],
  );
  const {x3,reserved}=x3Allocation(input.amount);
  await client.query(
    `INSERT INTO x3_package_reserve_ledger(
       package_purchase_id,user_id,package_id,package_amount,x3_allocation,reserved_amount,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [input.purchaseId,input.userId,input.packageId,input.amount.toString(),x3.toString(),reserved.toString(),`x3:reserve:${input.purchaseId}`],
  );
  await releaseHeldX3(client,input.userId,input.packageId,input.purchaseId,input.upgradeTimestamp);
  if(input.sourceEventId&&input.logIndex!==undefined&&await isDirectX3Purchase(client,input.blockNumber,input.logIndex)){
    const direct=await processDirectX3PackagePurchase(client,{...input,sourceEventId:input.sourceEventId,logIndex:input.logIndex});
    return{membershipId:membership.rows[0].id,x3Allocation:x3,reserved,...direct};
  }
  const sponsorAnchor=await ensureAnchorCycle(client,sponsor,input.packageId);
  const buyerCycle=await createCycle(client,input.userId,input.packageId,sponsor,null);
  await placeCycle(client,{
    cycle:buyerCycle,sponsorAnchor,sourceUserId:input.userId,sourcePurchaseId:input.purchaseId,
    originalAllocation:x3,allocation:x3,txHash:input.txHash,blockNumber:input.blockNumber,
    sourceEventId:input.sourceEventId,type:"DIRECT",depth:0,cascadeBudget:32,
    previousRecycleEventId:null,recycleChain:[],
  });
  return{duplicate:false,membershipId:membership.rows[0].id,cycleId:buyerCycle.id,x3Allocation:x3,reserved};
}

async function sponsorOf(client:PoolClient,userId:string){
  const row=await client.query<{sponsor_user_id:string}>(
    "SELECT sponsor_user_id FROM referral_relations WHERE user_id=$1",[userId],
  );
  if(!row.rows[0]){
    const root=await client.query("SELECT 1 FROM matrix_placements WHERE user_id=$1 AND parent_user_id IS NULL",[userId]);
    if(root.rows[0])return userId;
    throw new ApiError(409,"Permanent sponsor is not indexed","X3_SPONSOR_MISSING");
  }
  return row.rows[0].sponsor_user_id;
}

async function ensureAnchorCycle(client:PoolClient,userId:string,packageId:number){
  const existing=await client.query<Cycle>(
    `SELECT id,user_id,cycle_number,sponsor_user_id FROM x3_cycles
     WHERE user_id=$1 AND package_id=$2 AND cycle_number=1 FOR UPDATE`,
    [userId,packageId],
  );
  if(existing.rows[0])return existing.rows[0];
  const sponsor=await sponsorOf(client,userId);
  return createCycle(client,userId,packageId,sponsor,null);
}

async function createCycle(
  client:PoolClient,userId:string,packageId:number,sponsorUserId:string,recycledFrom:string|null,
){
  const next=await client.query<{cycle_number:number}>(
    "SELECT COALESCE(max(cycle_number),0)::int+1 cycle_number FROM x3_cycles WHERE user_id=$1 AND package_id=$2",
    [userId,packageId],
  );
  const cycleNumber=next.rows[0].cycle_number;
  const result=await client.query<Cycle>(
    `INSERT INTO x3_cycles(
       user_id,package_id,cycle_number,status,sponsor_user_id,recycled_from_cycle_id
     ) VALUES($1,$2,$3,'ACTIVE',$4,$5)
     RETURNING id,user_id,cycle_number,sponsor_user_id`,
    [userId,packageId,cycleNumber,sponsorUserId,recycledFrom],
  );
  return result.rows[0];
}

async function findParentCycle(client:PoolClient,anchorId:string,packageId:number){
  const result=await client.query<{id:string;user_id:string;slot_count:number;depth:number}>(
    `WITH RECURSIVE tree AS (
       SELECT c.id,c.user_id,0 depth,''::text path
       FROM x3_cycles c WHERE c.id=$1 AND c.package_id=$2
       UNION ALL
       SELECT child.id,child.user_id,t.depth+1,t.path||lpad(s.slot_number::text,2,'0')
       FROM tree t JOIN x3_cycle_slots s ON s.cycle_id=t.id
       JOIN x3_cycles child ON child.id=s.placed_user_cycle_id
       WHERE t.depth<64
     )
     SELECT t.id,t.user_id,count(s.id)::int slot_count,t.depth
     FROM tree t LEFT JOIN x3_cycle_slots s ON s.cycle_id=t.id
     GROUP BY t.id,t.user_id,t.depth,t.path HAVING count(s.id)<3
     ORDER BY t.depth,t.path LIMIT 1`,
    [anchorId,packageId],
  );
  if(!result.rows[0])throw new ApiError(409,"X3 placement depth limit reached","X3_BFS_LIMIT");
  return result.rows[0];
}

async function placeCycle(client:PoolClient,input:{
  cycle:Cycle;sponsorAnchor:Cycle;sourceUserId:string;sourcePurchaseId:string|null;
  originalAllocation:bigint;allocation:bigint;txHash:string;blockNumber:number;
  sourceEventId:string|null;
  type:"DIRECT"|"RECYCLE";depth:number;cascadeBudget:number;
  previousRecycleEventId:string|null;recycleChain:string[];
}):Promise<{eventId:string;terminalIncomeId:string|null;terminalPendingId:string|null}>{
  if(input.allocation<=0n||input.allocation!==input.originalAllocation)throw new ApiError(409,"Invalid carried X3 allocation","X3_ALLOCATION_INVARIANT");
  const parent=await findParentCycle(client,input.sponsorAnchor.id,Number((await client.query<{package_id:number}>("SELECT package_id FROM x3_cycles WHERE id=$1",[input.cycle.id])).rows[0].package_id));
  if(parent.user_id===input.cycle.user_id)throw new ApiError(409,"X3 self-placement rejected","X3_SELF_PLACEMENT");
  const slotNumber=parent.slot_count+1;
  const placementType=input.type==="RECYCLE"?"RECYCLE":parent.id===input.sponsorAnchor.id?"DIRECT":"SPILLOVER";
  const slot=await client.query<{id:string}>(
    `INSERT INTO x3_cycle_slots(
       cycle_id,slot_number,placed_user_id,placed_user_purchase_id,placed_user_cycle_id,
       placement_type,x3_allocation_amount,source_transaction_hash,original_package_purchase_id,
       original_allocation_amount,carried_allocation_amount,recycle_depth,previous_recycle_event_id,
       source_contract_event_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$4,$9,$7,$10,$11,$12) RETURNING id`,
    [parent.id,slotNumber,input.cycle.user_id,input.sourcePurchaseId,input.cycle.id,placementType,
      input.allocation.toString(),input.txHash,input.originalAllocation.toString(),input.depth,input.previousRecycleEventId,input.sourceEventId],
  );
  await client.query(
    `UPDATE x3_cycles SET matrix_parent_user_id=$2,parent_cycle_id=$3,updated_at=now() WHERE id=$1`,
    [input.cycle.id,parent.user_id,parent.id],
  );
  const sponsor=await sponsorOf(client,input.cycle.user_id);
  const event=await client.query<{id:string}>(
    `INSERT INTO x3_placement_events(
       package_id,cycle_id,placed_user_id,matrix_parent_user_id,sponsor_user_id,
       placement_type,idempotency_key,transaction_hash,block_number,source_package_purchase_id,
       original_allocation_amount,carried_allocation_amount,recycle_depth,previous_recycle_event_id,
       source_contract_event_id
     ) SELECT package_id,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13
       FROM x3_cycles WHERE id=$1 RETURNING id`,
    [input.cycle.id,input.cycle.user_id,parent.user_id,sponsor,placementType,`x3:placement:${input.cycle.id}`,
      input.txHash,input.blockNumber,input.sourcePurchaseId,input.originalAllocation.toString(),input.depth,input.previousRecycleEventId,input.sourceEventId],
  );
  const incomeId=await createSlotIncome(client,{
    ownerUserId:parent.user_id,ownerCycleId:parent.id,slotId:slot.rows[0].id,
    packageId:Number((await client.query<{package_id:number}>("SELECT package_id FROM x3_cycles WHERE id=$1",[parent.id])).rows[0].package_id),
    slotNumber,sourceUserId:input.sourceUserId,sourcePurchaseId:input.sourcePurchaseId!,
    amount:input.allocation,
  });
  if(slotNumber===3){
    const terminal=await completeAndRecycle(client,parent,input,event.rows[0].id);
    return{eventId:event.rows[0].id,...terminal};
  }
  return{eventId:event.rows[0].id,terminalIncomeId:incomeId,terminalPendingId:null};
}

async function createSlotIncome(client:PoolClient,input:{
  ownerUserId:string;ownerCycleId:string;slotId:string;packageId:number;slotNumber:number;
  sourceUserId:string;sourcePurchaseId:string;amount:bigint;
}):Promise<string>{
  const key=`x3:slot:${input.slotId}`;
  if(input.slotNumber===3){
    await client.query(
      `INSERT INTO x3_income_ledger(
         owner_user_id,package_id,owner_cycle_id,slot_id,source_user_id,
         source_package_purchase_id,gross_amount,status,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'RECYCLE',$8)`,
      [input.ownerUserId,input.packageId,input.ownerCycleId,input.slotId,input.sourceUserId,input.sourcePurchaseId,input.amount.toString(),key],
    );
    return (await client.query<{id:string}>("SELECT id FROM x3_income_ledger WHERE slot_id=$1",[input.slotId])).rows[0].id;
  }
  const active=await client.query(
    "SELECT 1 FROM x3_package_memberships WHERE user_id=$1 AND package_id=$2",
    [input.ownerUserId,input.packageId],
  );
  if(!active.rows[0]){
    const income=await client.query<{id:string}>(
      `INSERT INTO x3_income_ledger(
         owner_user_id,package_id,owner_cycle_id,slot_id,source_user_id,
         source_package_purchase_id,gross_amount,status,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'HELD',$8) RETURNING id`,
      [input.ownerUserId,input.packageId,input.ownerCycleId,input.slotId,input.sourceUserId,input.sourcePurchaseId,input.amount.toString(),key],
    );
    await client.query(
      `WITH stamp AS (SELECT transaction_timestamp() held_at)
       INSERT INTO x3_hold_ledger(user_id,package_id,x3_income_ledger_id,amount,status,held_at,expires_at)
       SELECT $1,$2,$3,$4,'HELD',held_at,held_at+interval '48 hours' FROM stamp`,
      [input.ownerUserId,input.packageId,income.rows[0].id,input.amount.toString()],
    );
    return income.rows[0].id;
  }
  const capped=await creditGrossEarning({
    userId:input.ownerUserId,incomeType:"X3_PACKAGE",sourceReference:input.slotId,
    grossAmount:input.amount,idempotencyKey:`x3:cap:${input.slotId}`,
  },client);
  const income=await client.query<{id:string}>(
    `INSERT INTO x3_income_ledger(
       owner_user_id,package_id,owner_cycle_id,slot_id,source_user_id,
       source_package_purchase_id,gross_amount,status,credited_amount,excess_amount,
       wallet_ledger_id,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [input.ownerUserId,input.packageId,input.ownerCycleId,input.slotId,input.sourceUserId,input.sourcePurchaseId,
      input.amount.toString(),capped.excess>0n?"CAPPED":"WITHDRAWABLE",capped.credited.toString(),
      capped.excess.toString(),capped.ledgerId,key],
  );
  return income.rows[0].id;
}

export async function releaseHeldX3(client:PoolClient,userId:string,packageId:number,purchaseId:string,upgradeTimestamp:Date){
  const holds=await client.query<{id:string;user_id:string;package_id:number;x3_income_ledger_id:string|null;x3_direct_income_ledger_id:string|null;amount:string;held_at:Date;expires_at:Date|null}>(
    `SELECT id,user_id,package_id,x3_income_ledger_id,x3_direct_income_ledger_id,amount::text,held_at,expires_at FROM x3_hold_ledger
     WHERE user_id=$1 AND package_id=$2 AND status='HELD' ORDER BY held_at,id FOR UPDATE`,
    [userId,packageId],
  );
  for(const hold of holds.rows){
    if(!isX3HoldReleaseEligible(upgradeTimestamp,hold.expires_at)){
      await flushLockedX3Hold(client,{...hold,expires_at:hold.expires_at!},"PACKAGE");
      continue;
    }
    const amount=BigInt(hold.amount);
    const capped=await creditGrossEarning({
      userId,incomeType:"X3_HOLD_RELEASE",sourceReference:hold.id,grossAmount:amount,
      idempotencyKey:`x3:hold-release:${hold.id}`,
    },client);
    if(hold.x3_income_ledger_id)await client.query(
      `UPDATE x3_hold_ledger SET status=$2,release_purchase_id=$3,released_amount=$4,
       excess_amount=$5,released_at=now() WHERE id=$1 AND status='HELD'`,
      [hold.id,capped.excess>0n?"PARTIALLY_CAPPED":"RELEASED",purchaseId,capped.credited.toString(),capped.excess.toString()],
    );
    await client.query(
      `UPDATE x3_income_ledger SET status='RELEASED',credited_amount=$2,excess_amount=$3,
       wallet_ledger_id=$4,released_at=now() WHERE id=$1 AND status='HELD'`,
      [hold.x3_income_ledger_id,capped.credited.toString(),capped.excess.toString(),capped.ledgerId],
    );
    if(hold.x3_direct_income_ledger_id)await client.query(
      `UPDATE x3_direct_income_ledger SET status='RELEASED',credited_amount=$2,excess_amount=$3,
       wallet_ledger_id=$4,released_at=now() WHERE id=$1 AND status='HELD'`,
      [hold.x3_direct_income_ledger_id,capped.credited.toString(),capped.excess.toString(),capped.ledgerId]);
    await client.query(`INSERT INTO x3_hold_release_history(hold_id,user_id,package_id,release_purchase_id,gross_amount,split_event_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(hold_id) DO NOTHING`,[hold.id,userId,packageId,purchaseId,amount.toString(),capped.splitEventId,`x3:release-history:${hold.id}`]);
  }
  return holds.rowCount;
}

async function completeAndRecycle(client:PoolClient,parent:{id:string;user_id:string},source:{
  txHash:string;blockNumber:number;sourceUserId:string;sourcePurchaseId:string|null;depth:number;
  originalAllocation:bigint;allocation:bigint;previousRecycleEventId:string|null;recycleChain:string[];
  sourceEventId:string|null;cascadeBudget:number;
},placementEventId:string):Promise<{terminalIncomeId:string|null;terminalPendingId:string|null}>{
  const current=await client.query<Cycle&{package_id:number;status:string}>(
    `SELECT id,user_id,cycle_number,sponsor_user_id,package_id,status FROM x3_cycles WHERE id=$1 FOR UPDATE`,
    [parent.id],
  );
  if(current.rows[0].status==="COMPLETED"){
    const existing=await client.query<{terminal_income_id:string|null;terminal_pending_id:string|null}>(
      "SELECT terminal_income_id,terminal_pending_id FROM x3_recycle_events WHERE completed_cycle_id=$1",[parent.id],
    );
    return{terminalIncomeId:existing.rows[0]?.terminal_income_id||null,terminalPendingId:existing.rows[0]?.terminal_pending_id||null};
  }
  const cycle=current.rows[0];
  await client.query("UPDATE x3_cycles SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1",[cycle.id]);
  const next=await createCycle(client,cycle.user_id,cycle.package_id,cycle.sponsor_user_id,cycle.id);
  const recycle=await client.query<{id:string}>(
    `INSERT INTO x3_recycle_events(
       package_id,completed_cycle_id,new_cycle_id,user_id,recycle_number,placement_event_id,idempotency_key,
       source_package_purchase_id,original_allocation_amount,carried_allocation_amount,recycle_depth,
       previous_recycle_event_id,source_contract_event_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12) RETURNING id`,
    [cycle.package_id,cycle.id,next.id,cycle.user_id,next.cycle_number-1,placementEventId,
      `x3:recycle:${source.sourcePurchaseId}:${cycle.id}`,source.sourcePurchaseId,
      source.originalAllocation.toString(),source.depth+1,source.previousRecycleEventId,source.sourceEventId],
  );
  const recycleId=recycle.rows[0].id,chain=[...source.recycleChain,recycleId];
  if(cycle.sponsor_user_id===cycle.user_id){
    const pending=await persistPending(client,cycle,source,recycleId,chain,"ROOT_PENDING","No permanent sponsor/root payout rule");
    await finalizeRecycle(client,recycleId,null,null,pending);
    return{terminalIncomeId:null,terminalPendingId:pending};
  }
  if(source.cascadeBudget<=0){
    const pending=await persistPending(client,cycle,source,recycleId,chain,"RECYCLE_PENDING","Maximum recycle cascade depth reached");
    await finalizeRecycle(client,recycleId,null,null,pending);
    return{terminalIncomeId:null,terminalPendingId:pending};
  }
  const anchor=await ensureAnchorCycle(client,cycle.sponsor_user_id,cycle.package_id);
  const result=await placeCycle(client,{
    cycle:next,sponsorAnchor:anchor,sourceUserId:source.sourceUserId,sourcePurchaseId:source.sourcePurchaseId,
    originalAllocation:source.originalAllocation,allocation:source.allocation,txHash:source.txHash,
    blockNumber:source.blockNumber,type:"RECYCLE",depth:source.depth+1,
    cascadeBudget:source.cascadeBudget-1,sourceEventId:source.sourceEventId,
    previousRecycleEventId:recycleId,recycleChain:chain,
  });
  await finalizeRecycle(client,recycleId,result.eventId,result.terminalIncomeId,result.terminalPendingId);
  return{terminalIncomeId:result.terminalIncomeId,terminalPendingId:result.terminalPendingId};
}

export async function resumeX3PendingAllocation(client:PoolClient,pendingId:string){
  const resolved=await client.query<{id:string}>(
    "SELECT id FROM x3_pending_resolutions WHERE pending_allocation_id=$1",[pendingId],
  );
  if(resolved.rows[0])return{status:"SKIPPED" as const,resolutionId:resolved.rows[0].id};
  const pending=await client.query<{
    id:string;status:string;package_id:number;source_package_purchase_id:string;
    source_contract_event_id:string|null;original_allocation_amount:string;
    carried_allocation_amount:string;recycle_depth:number;recycle_chain:string[];
    previous_recycle_event_id:string;new_cycle_id:string;cycle_user_id:string;
    cycle_number:number;sponsor_user_id:string;tx_hash:string;block_number:string;
    source_user_id:string;
  }>(
    `SELECT p.id,p.status,p.package_id,p.source_package_purchase_id,p.source_contract_event_id,
      p.original_allocation_amount::text,p.carried_allocation_amount::text,p.recycle_depth,
      p.recycle_chain,r.new_cycle_id,c.user_id cycle_user_id,c.cycle_number,c.sponsor_user_id,
      pp.tx_hash,pp.block_number::text,pp.user_id source_user_id
     FROM x3_pending_allocations p
     JOIN x3_recycle_events r ON r.id=p.previous_recycle_event_id
     JOIN x3_cycles c ON c.id=r.new_cycle_id
     JOIN package_purchases pp ON pp.id=p.source_package_purchase_id
     WHERE p.id=$1 FOR UPDATE OF p,c`,
    [pendingId],
  );
  const row=pending.rows[0];
  if(!row)throw new ApiError(404,"X3 pending allocation not found","X3_PENDING_NOT_FOUND");
  if(row.status==="ROOT_PENDING")return{status:"ROOT_PENDING" as const};
  if(row.status!=="RECYCLE_PENDING")throw new ApiError(409,"X3 allocation is not recoverable","X3_PENDING_NOT_RECOVERABLE");
  const cycle:Cycle={id:row.new_cycle_id,user_id:row.cycle_user_id,cycle_number:row.cycle_number,sponsor_user_id:row.sponsor_user_id};
  const anchor=await ensureAnchorCycle(client,row.sponsor_user_id,row.package_id);
  const result=await placeCycle(client,{
    cycle,sponsorAnchor:anchor,sourceUserId:row.source_user_id,
    sourcePurchaseId:row.source_package_purchase_id,sourceEventId:row.source_contract_event_id,
    originalAllocation:BigInt(row.original_allocation_amount),
    allocation:BigInt(row.carried_allocation_amount),txHash:row.tx_hash,
    blockNumber:Number(row.block_number),type:"RECYCLE",depth:row.recycle_depth,
    cascadeBudget:32,previousRecycleEventId:row.previous_recycle_event_id,
    recycleChain:Array.isArray(row.recycle_chain)?row.recycle_chain:[],
  });
  let terminalStatus:"WITHDRAWABLE"|"HELD"|"CAPPED"|"ROOT_PENDING"|"RECYCLE_PENDING";
  if(result.terminalIncomeId){
    const income=await client.query<{status:"WITHDRAWABLE"|"HELD"|"CAPPED"}>(
      "SELECT status FROM x3_income_ledger WHERE id=$1",[result.terminalIncomeId],
    );
    terminalStatus=income.rows[0].status;
  }else{
    const next=await client.query<{status:"ROOT_PENDING"|"RECYCLE_PENDING"}>(
      "SELECT status FROM x3_pending_allocations WHERE id=$1",[result.terminalPendingId],
    );
    terminalStatus=next.rows[0].status;
  }
  const resolution=await client.query<{id:string}>(
    `INSERT INTO x3_pending_resolutions(
       pending_allocation_id,resulting_placement_id,terminal_income_id,next_pending_allocation_id,
       result_status,recovery_depth,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(pending_allocation_id) DO NOTHING RETURNING id`,
    [pendingId,result.eventId,result.terminalIncomeId,result.terminalPendingId,terminalStatus,
      row.recycle_depth,`x3:pending-resolution:${pendingId}`],
  );
  const resolutionId=resolution.rows[0]?.id||(await client.query<{id:string}>(
    "SELECT id FROM x3_pending_resolutions WHERE pending_allocation_id=$1",[pendingId],
  )).rows[0].id;
  return{status:"RECOVERED" as const,resolutionId,terminalStatus,...result};
}

async function persistPending(client:PoolClient,cycle:{id:string;user_id:string;package_id:number},source:{
  sourcePurchaseId:string|null;sourceEventId:string|null;originalAllocation:bigint;allocation:bigint;depth:number;
},previousRecycleEventId:string,chain:string[],status:"ROOT_PENDING"|"RECYCLE_PENDING",reason:string){
  const result=await client.query<{id:string}>(
    `INSERT INTO x3_pending_allocations(
       package_id,source_package_purchase_id,original_allocation_amount,carried_allocation_amount,
       source_contract_event_id,completed_cycle_id,recycle_chain,root_user_id,status,reason,recycle_depth,
       previous_recycle_event_id,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [cycle.package_id,source.sourcePurchaseId,source.originalAllocation.toString(),source.allocation.toString(),
      source.sourceEventId,cycle.id,JSON.stringify(chain),cycle.user_id,status,reason,source.depth+1,previousRecycleEventId,
      `x3:pending:${source.sourcePurchaseId}:${cycle.id}:${status}`],
  );
  const pendingId=result.rows[0]?.id||(await client.query<{id:string}>(
    "SELECT id FROM x3_pending_allocations WHERE idempotency_key=$1",
    [`x3:pending:${source.sourcePurchaseId}:${cycle.id}:${status}`],
  )).rows[0].id;
  await client.query(
    `INSERT INTO x3_recovery_schedule(pending_allocation_id,recovery_state,next_attempt_at)
     VALUES($1,$2,now()) ON CONFLICT(pending_allocation_id) DO NOTHING`,
    [pendingId,status==="RECYCLE_PENDING"?"PENDING":"PAUSED"],
  );
  return pendingId;
}

async function finalizeRecycle(
  client:PoolClient,recycleId:string,placementId:string|null,incomeId:string|null,pendingId:string|null,
){
  await client.query(
    `UPDATE x3_recycle_events SET resulting_placement_id=$2,terminal_income_id=$3,terminal_pending_id=$4
     WHERE id=$1 AND resulting_placement_id IS NULL AND terminal_income_id IS NULL AND terminal_pending_id IS NULL`,
    [recycleId,placementId,incomeId,pendingId],
  );
}
