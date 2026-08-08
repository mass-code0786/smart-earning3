import type {PoolClient} from"pg";
import{ApiError}from"./http";
import{creditGrossEarning}from"./earning-split-service";
import{recordConfirmedMagicFunding}from"./earning-split-service";
import{X4_PACKAGE_PRICES,x4Income,x4LevelForSlot}from"./x4-math";
import{assertModuleActive}from"./module-control-service";

export type X4PurchaseInput={
  purchaseId:string;userId:string;packageId:number;amount:bigint;
  txHash:string;blockNumber:number;sourceEventId:string|null;
  onchain:{user:string;owner:string;slot:number;level:number;accountingAmount:bigint;
    magicSourceReference?:string;confirmedGrossCredit?:bigint};
};
type Cycle={id:string;user_id:string;package_id:number;cycle_number:number};

async function audit(client:PoolClient,input:{
  event:string;packageId:number;userId?:string;cycleId?:string;positionId?:string;
  key:string;metadata?:Record<string,unknown>;
}){
  await client.query(
    `INSERT INTO x4_audit_logs(event_type,package_id,user_id,cycle_id,position_id,idempotency_key,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(idempotency_key) DO NOTHING`,
    [input.event,input.packageId,input.userId||null,input.cycleId||null,input.positionId||null,
      input.key,JSON.stringify(input.metadata||{})],
  );
}

async function createCycle(client:PoolClient,userId:string,packageId:number,recycledFrom:string|null){
  const number=await client.query<{cycle_number:number}>(
    "SELECT COALESCE(max(cycle_number),0)::int+1 cycle_number FROM x4_cycles WHERE user_id=$1 AND package_id=$2",
    [userId,packageId],
  );
  const created=await client.query<Cycle>(
    `INSERT INTO x4_cycles(user_id,package_id,cycle_number,recycled_from_cycle_id)
     VALUES($1,$2,$3,$4) RETURNING id,user_id,package_id,cycle_number`,
    [userId,packageId,number.rows[0].cycle_number,recycledFrom],
  );
  const sequence=await client.query<{queue_sequence:string}>(
    "SELECT COALESCE(max(queue_sequence),0)+1 AS queue_sequence FROM x4_queue WHERE package_id=$1",
    [packageId],
  );
  await client.query(
    `INSERT INTO x4_queue(package_id,cycle_id,queue_sequence) VALUES($1,$2,$3)`,
    [packageId,created.rows[0].id,sequence.rows[0].queue_sequence],
  );
  return created.rows[0];
}

async function nextReceiver(client:PoolClient,packageId:number,placedCycleId:string){
  const result=await client.query<Cycle&{slot_count:number}>(
    `SELECT c.id,c.user_id,c.package_id,c.cycle_number,count(p.id)::int slot_count
     FROM x4_queue q JOIN x4_cycles c ON c.id=q.cycle_id
     LEFT JOIN x4_positions p ON p.owner_cycle_id=c.id
     WHERE q.package_id=$1 AND q.status='WAITING' AND c.id<>$2
     GROUP BY q.queue_sequence,c.id
     HAVING count(p.id)<6
     ORDER BY q.queue_sequence
     LIMIT 1`,
    [packageId,placedCycleId],
  );
  return result.rows[0]||null;
}

async function creditPosition(client:PoolClient,input:{
  positionId:string;packageId:number;slot:number;ownerCycleId:string;ownerUserId:string;
  sourceUserId:string;amount:bigint;txHash:string;magicSourceReference?:string;
  confirmedGrossCredit?:bigint;
}){
  const level=x4LevelForSlot(input.slot),gross=x4Income(input.amount,level);
  if(level===1){
    const key=`x4:magic:${input.positionId}`;
    if(!input.magicSourceReference)throw new ApiError(409,"X4 on-chain Magic evidence is missing","X4_EVENT_MISMATCH");
    await recordConfirmedMagicFunding(client,{userId:input.ownerUserId,
      sourceType:input.slot===1?"X4_LEVEL_1_A_MAGIC":"X4_LEVEL_1_B_MAGIC",
      sourceReference:input.magicSourceReference,amount:gross,reason:"X4_ONCHAIN_MAGIC",
      idempotencyKey:key,txHash:input.txHash});
    const funding=(await client.query<{id:string}>("SELECT id FROM magic_funding_events WHERE source_reference=$1",[input.magicSourceReference])).rows[0];
    await client.query(
      `INSERT INTO x4_income_history(
         package_id,owner_user_id,source_user_id,owner_cycle_id,position_id,level_number,
         wallet_type,gross_amount,credited_amount,magic_funding_event_id,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,1,'MAGIC_LEVEL',$6,$6,$7,$8)
       ON CONFLICT(position_id) DO NOTHING`,
      [input.packageId,input.ownerUserId,input.sourceUserId,input.ownerCycleId,input.positionId,
        gross.toString(),funding.id,`x4:income:${input.positionId}`],
    );
    return;
  }
  if(input.confirmedGrossCredit===undefined)
    throw new ApiError(409,"X4 on-chain earning evidence is missing","X4_EVENT_MISMATCH");
  const capped=await creditGrossEarning({
    userId:input.ownerUserId,incomeType:"X4_GLOBAL",sourceReference:input.positionId,
    grossAmount:gross,idempotencyKey:`x4:cap:${input.positionId}`,
    confirmedOnchainCredit:input.confirmedGrossCredit,magicAlreadyOnchain:true,
  },client);
  await client.query(
    `INSERT INTO x4_income_history(
       package_id,owner_user_id,source_user_id,owner_cycle_id,position_id,level_number,
       wallet_type,gross_amount,credited_amount,excess_amount,income_credit_ledger_id,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,2,'EARNING',$6,$7,$8,$9,$10)
     ON CONFLICT(position_id) DO NOTHING`,
    [input.packageId,input.ownerUserId,input.sourceUserId,input.ownerCycleId,input.positionId,
      gross.toString(),capped.credited.toString(),capped.excess.toString(),capped.ledgerId,
      `x4:income:${input.positionId}`],
  );
}

export async function processX4PackagePurchase(client:PoolClient,input:X4PurchaseInput){
  await assertModuleActive("X4_PLACEMENT",client);
  const expected=X4_PACKAGE_PRICES[input.packageId-1];
  if(!expected||expected.price!==input.amount)
    throw new ApiError(422,"X4 package amount mismatch","X4_AMOUNT_MISMATCH");
  const buyerWallet=(await client.query<{wallet_address:string}>(
    "SELECT wallet_address FROM users WHERE id=$1",[input.userId])).rows[0]?.wallet_address;
  if(!buyerWallet||buyerWallet.toLowerCase()!==input.onchain.user.toLowerCase())
    throw new ApiError(409,"X4 event buyer does not match the package owner","X4_EVENT_MISMATCH");

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`x4:package:${input.packageId}`]);
  const duplicate=await client.query<{id:string}>(
    "SELECT id FROM x4_package_memberships WHERE activation_purchase_id=$1",[input.purchaseId],
  );
  if(duplicate.rows[0])return{membershipId:duplicate.rows[0].id,duplicate:true};

  const membership=await client.query<{id:string}>(
    `INSERT INTO x4_package_memberships(user_id,package_id,activation_purchase_id)
     VALUES($1,$2,$3) RETURNING id`,
    [input.userId,input.packageId,input.purchaseId],
  );
  let placed=await createCycle(client,input.userId,input.packageId,null);
  await audit(client,{event:"PACKAGE_JOINED",packageId:input.packageId,userId:input.userId,
    cycleId:placed.id,key:`x4:join:${input.purchaseId}`,metadata:{purchaseId:input.purchaseId}});

  for(;;){
    const receiver=await nextReceiver(client,input.packageId,placed.id);
    if(!receiver){
      if(input.onchain.owner!=="0x0000000000000000000000000000000000000000"
        ||input.onchain.slot!==0||input.onchain.level!==0||input.onchain.accountingAmount!==0n)
        throw new ApiError(409,"X4 root event does not match the indexed queue","X4_EVENT_MISMATCH");
      await audit(client,{event:"GLOBAL_ROOT_CREATED",packageId:input.packageId,userId:placed.user_id,
        cycleId:placed.id,key:`x4:root:${placed.id}`});
      return{membershipId:membership.rows[0].id,cycleId:placed.id,duplicate:false};
    }
    const slot=receiver.slot_count+1,level=x4LevelForSlot(slot);
    const ownerWallet=(await client.query<{wallet_address:string}>(
      "SELECT wallet_address FROM users WHERE id=$1",[receiver.user_id])).rows[0]?.wallet_address;
    if(!ownerWallet||ownerWallet.toLowerCase()!==input.onchain.owner.toLowerCase()
      ||slot!==input.onchain.slot||level!==input.onchain.level
      ||x4Income(input.amount,level)!==input.onchain.accountingAmount)
      throw new ApiError(409,"X4 event does not match the indexed queue","X4_EVENT_MISMATCH");
    const position=await client.query<{id:string}>(
      `INSERT INTO x4_positions(
         package_id,owner_cycle_id,slot_number,level_number,placed_cycle_id,placed_user_id,
         source_package_purchase_id,placement_type,source_transaction_hash,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [input.packageId,receiver.id,slot,level,placed.id,placed.user_id,input.purchaseId,
        placed.cycle_number===1?"PURCHASE":"RECYCLE",input.txHash,`x4:placement:${placed.id}`],
    );
    await client.query(
      "UPDATE x4_cycles SET parent_cycle_id=$2,placement_slot=$3,updated_at=now() WHERE id=$1",
      [placed.id,receiver.id,slot],
    );
    await creditPosition(client,{positionId:position.rows[0].id,packageId:input.packageId,slot,
      ownerCycleId:receiver.id,ownerUserId:receiver.user_id,sourceUserId:input.userId,amount:input.amount,
      txHash:input.txHash,magicSourceReference:input.onchain.magicSourceReference,
      confirmedGrossCredit:input.onchain.confirmedGrossCredit});
    await audit(client,{event:"PLACEMENT",packageId:input.packageId,userId:placed.user_id,
      cycleId:receiver.id,positionId:position.rows[0].id,key:`x4:audit:placement:${position.rows[0].id}`,
      metadata:{slot,level,placedCycleId:placed.id}});
    if(slot<6)return{membershipId:membership.rows[0].id,cycleId:placed.id,duplicate:false};

    await client.query(
      "UPDATE x4_cycles SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1 AND status='ACTIVE'",
      [receiver.id],
    );
    await client.query(
      "UPDATE x4_queue SET status='FILLED',filled_at=now() WHERE cycle_id=$1 AND status='WAITING'",
      [receiver.id],
    );
    const recycled=await createCycle(client,receiver.user_id,input.packageId,receiver.id);
    await client.query(
      `INSERT INTO x4_recycle_history(
         package_id,user_id,completed_cycle_id,new_cycle_id,recycle_number,triggering_position_id,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [input.packageId,receiver.user_id,receiver.id,recycled.id,recycled.cycle_number-1,
        position.rows[0].id,`x4:recycle:${receiver.id}`],
    );
    await audit(client,{event:"CYCLE_COMPLETED",packageId:input.packageId,userId:receiver.user_id,
      cycleId:receiver.id,positionId:position.rows[0].id,key:`x4:complete:${receiver.id}`,
      metadata:{newCycleId:recycled.id}});
    return{membershipId:membership.rows[0].id,cycleId:placed.id,recycledCycleId:recycled.id,duplicate:false};
  }
}
