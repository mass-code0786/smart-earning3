import type{PoolClient}from"pg";
import{creditGrossEarning}from"./earning-split-service";
import{AUTOPOOL_INCOME,AUTOPOOL_TOTAL_POSITIONS,autopoolCoordinates}from"./autopool-math";
import{assertModuleActive}from"./module-control-service";

async function audit(client:PoolClient,event:string,key:string,input:{userId?:string;entryId?:string;positionId?:string;metadata?:Record<string,unknown>}={}){
 await client.query(`INSERT INTO autopool_audit_logs(event_type,user_id,entry_id,position_id,idempotency_key,metadata)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING`,[event,input.userId||null,input.entryId||null,input.positionId||null,key,JSON.stringify(input.metadata||{})]);
}

/** Creates and globally places exactly one Autopool entry for a Booster entry. Must run in the Booster transaction. */
export async function createAutopoolEntryForBooster(client:PoolClient,input:{boosterEntryId:string;userId:string}){
 await assertModuleActive("GLOBAL_AUTOPOOL_WORKER",client);
 await client.query("SELECT pg_advisory_xact_lock(hashtext('autopool:global-fifo'))");
 const existing=(await client.query<{id:string}>("SELECT id FROM autopool_entries WHERE booster_entry_id=$1",[input.boosterEntryId])).rows[0];
 if(existing)return{entryId:existing.id,duplicate:true,placements:0};
 const entry=(await client.query<{id:string}>(`INSERT INTO autopool_entries(owner_user_id,booster_entry_id)
  VALUES($1,$2) ON CONFLICT(booster_entry_id) DO NOTHING RETURNING id`,[input.userId,input.boosterEntryId])).rows[0];
 if(!entry){const row=(await client.query<{id:string}>("SELECT id FROM autopool_entries WHERE booster_entry_id=$1",[input.boosterEntryId])).rows[0];return{entryId:row.id,duplicate:true,placements:0}}
 await client.query("INSERT INTO autopool_global_queue(entry_id) VALUES($1)",[entry.id]);
 const owner=(await client.query<{id:string;owner_user_id:string;filled_positions:number}>(`SELECT e.id,e.owner_user_id,e.filled_positions
  FROM autopool_entries e JOIN autopool_global_queue q ON q.entry_id=e.id
  WHERE e.status='ACTIVE' AND e.id<>$1 ORDER BY q.queue_sequence LIMIT 1 FOR UPDATE OF e`,[entry.id])).rows[0];
 let placements=0;
 if(owner){
  const positionNumber=owner.filled_positions+1;
  if(positionNumber>AUTOPOOL_TOTAL_POSITIONS)throw new Error("Active Autopool entry has no remaining position");
  const coordinate=autopoolCoordinates(positionNumber);
  const position=(await client.query<{id:string}>(`INSERT INTO autopool_positions(owner_entry_id,placed_entry_id,placed_user_id,
   position_number,matrix_level,level_position,parent_position_number,child_slot,idempotency_key)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[owner.id,entry.id,input.userId,positionNumber,coordinate.level,
   coordinate.levelPosition,coordinate.parentPosition,coordinate.childSlot,`autopool:position:${owner.id}:${entry.id}`])).rows[0];
  const credit=await creditGrossEarning({userId:owner.owner_user_id,incomeType:"GLOBAL_AUTOPOOL",sourceReference:position.id,
   grossAmount:AUTOPOOL_INCOME,idempotencyKey:`autopool:income-cap:${position.id}`},client);
  await client.query(`INSERT INTO autopool_income_history(owner_user_id,source_user_id,owner_entry_id,position_id,matrix_level,
   gross_amount,credited_amount,excess_amount,income_credit_ledger_id,idempotency_key)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[owner.owner_user_id,input.userId,owner.id,position.id,coordinate.level,
   AUTOPOOL_INCOME.toString(),credit.credited.toString(),credit.excess.toString(),credit.ledgerId,`autopool:income:${position.id}`]);
  const completed=positionNumber===AUTOPOOL_TOTAL_POSITIONS;
  await client.query(`UPDATE autopool_entries SET filled_positions=$2,status=$3::varchar,completed_at=CASE WHEN $3::varchar='COMPLETED' THEN now() ELSE NULL END WHERE id=$1`,
   [owner.id,positionNumber,completed?"COMPLETED":"ACTIVE"]);
  await audit(client,completed?"ENTRY_COMPLETED":"POSITION_FILLED",`autopool:audit:position:${position.id}`,
   {userId:owner.owner_user_id,entryId:owner.id,positionId:position.id,metadata:{positionNumber,level:coordinate.level,placedEntryId:entry.id}});
  placements++;
 }
 await audit(client,"ENTRY_CREATED",`autopool:audit:entry:${entry.id}`,{userId:input.userId,entryId:entry.id,metadata:{boosterEntryId:input.boosterEntryId}});
 return{entryId:entry.id,duplicate:false,placements};
}
