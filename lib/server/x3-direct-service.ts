import type{PoolClient}from"pg";
import{ApiError}from"./http";
import{creditGrossEarning}from"./earning-split-service";
import{x3Allocation,X3_PACKAGE_PRICES}from"./x3-math";

type Input={purchaseId:string;userId:string;packageId:number;amount:bigint;txHash:string;blockNumber:number;sourceEventId:string;logIndex:number};

async function openCycle(client:PoolClient,owner:string,packageId:number,number:number){
 const row=(await client.query<{id:string}>(`INSERT INTO x3_direct_cycles(owner_user_id,package_id,cycle_number,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(owner_user_id,package_id,cycle_number) DO UPDATE SET owner_user_id=EXCLUDED.owner_user_id RETURNING id`,[owner,packageId,number])).rows[0];
 await client.query(`INSERT INTO x3_direct_cycle_events(cycle_id,event_type,idempotency_key) VALUES($1,'CYCLE_OPENED',$2) ON CONFLICT(idempotency_key) DO NOTHING`,[row.id,`x3-direct:cycle-open:${owner}:${packageId}:${number}`]);return row.id;
}

async function creditOrHold(client:PoolClient,input:{slotId:string;recipient:string|null;packageId:number;gross:bigint}){
 const key=`x3-direct:slot:${input.slotId}`;
 if(!input.recipient){await client.query(`INSERT INTO x3_direct_income_ledger(slot_id,recipient_user_id,package_id,gross_amount,status,idempotency_key) VALUES($1,NULL,$2,$3,'GENESIS_RETAINED',$4)`,[input.slotId,input.packageId,input.gross.toString(),key]);return;}
 const qualified=await client.query("SELECT 1 FROM x3_package_memberships WHERE user_id=$1 AND package_id=$2",[input.recipient,input.packageId]);
 if(!qualified.rowCount){
  const income=(await client.query<{id:string}>(`INSERT INTO x3_direct_income_ledger(slot_id,recipient_user_id,package_id,gross_amount,status,idempotency_key) VALUES($1,$2,$3,$4,'HELD',$5) RETURNING id`,[input.slotId,input.recipient,input.packageId,input.gross.toString(),key])).rows[0];
  await client.query(`WITH stamp AS(SELECT transaction_timestamp() held_at) INSERT INTO x3_hold_ledger(user_id,package_id,x3_direct_income_ledger_id,amount,status,held_at,expires_at) SELECT $1,$2,$3,$4,'HELD',held_at,held_at+interval '48 hours' FROM stamp`,[input.recipient,input.packageId,income.id,input.gross.toString()]);return;
 }
 const capped=await creditGrossEarning({userId:input.recipient,incomeType:"X3_PACKAGE",sourceReference:input.slotId,grossAmount:input.gross,idempotencyKey:`x3-direct:cap:${input.slotId}`},client);
 await client.query(`INSERT INTO x3_direct_income_ledger(slot_id,recipient_user_id,package_id,gross_amount,status,credited_amount,excess_amount,wallet_ledger_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.slotId,input.recipient,input.packageId,input.gross.toString(),capped.excess>0n?'CAPPED':'WITHDRAWABLE',capped.credited.toString(),capped.excess.toString(),capped.ledgerId,key]);
}

export async function isDirectX3Purchase(client:PoolClient,blockNumber:number,logIndex:number){const r=(await client.query<{boundary_block_number:string;boundary_log_index:number;mode:string}>("SELECT boundary_block_number::text,boundary_log_index,mode FROM x3_direct_rollout WHERE singleton=true")).rows[0];if(!r)throw new ApiError(503,"Direct X3 rollout is not initialized","X3_DIRECT_ROLLOUT_MISSING");const after=blockNumber>Number(r.boundary_block_number)||(blockNumber===Number(r.boundary_block_number)&&logIndex>r.boundary_log_index);if(after&&r.mode!=="CONTRACT_ALIGNED")throw new ApiError(503,"Direct X3 requires the aligned contract deployment","X3_CONTRACT_ALIGNMENT_REQUIRED");return after}

export async function processDirectX3PackagePurchase(client:PoolClient,input:Input){
 const expected=X3_PACKAGE_PRICES[input.packageId-1];if(!expected||expected.price!==input.amount)throw new ApiError(422,"X3 package amount mismatch","X3_AMOUNT_MISMATCH");
 const duplicate=await client.query("SELECT id FROM x3_direct_cycle_slots WHERE buyer_package_purchase_id=$1",[input.purchaseId]);if(duplicate.rowCount)return{duplicate:true};
 const sponsor=(await client.query<{sponsor_user_id:string}>("SELECT sponsor_user_id FROM referral_relations WHERE user_id=$1",[input.userId])).rows[0];
 if(!sponsor)return{duplicate:false,genesisBuyer:true};
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`x3-direct:${sponsor.sponsor_user_id}:${input.packageId}`]);
 let cycle=(await client.query<{id:string;cycle_number:number}>("SELECT id,cycle_number FROM x3_direct_cycles WHERE owner_user_id=$1 AND package_id=$2 AND status='ACTIVE' FOR UPDATE",[sponsor.sponsor_user_id,input.packageId])).rows[0];
 if(!cycle){const n=Number((await client.query<{n:string}>("SELECT COALESCE(max(cycle_number),0)+1 n FROM x3_direct_cycles WHERE owner_user_id=$1 AND package_id=$2",[sponsor.sponsor_user_id,input.packageId])).rows[0].n);cycle={id:await openCycle(client,sponsor.sponsor_user_id,input.packageId,n),cycle_number:n};}
 const count=Number((await client.query<{n:string}>("SELECT count(*) n FROM x3_direct_cycle_slots WHERE cycle_id=$1",[cycle.id])).rows[0].n),slot=count+1;if(slot>3)throw new ApiError(409,"Direct X3 cycle is already full","X3_DIRECT_CYCLE_FULL");
 let recipient:string|null=sponsor.sponsor_user_id,disposition='OWNER_INCOME';if(slot===3){const up=(await client.query<{sponsor_user_id:string}>("SELECT sponsor_user_id FROM referral_relations WHERE user_id=$1",[sponsor.sponsor_user_id])).rows[0];recipient=up?.sponsor_user_id||null;disposition=recipient?'PASS_UP':'GENESIS_RETAINED';}
 const gross=x3Allocation(input.amount).x3,slotRow=(await client.query<{id:string}>(`INSERT INTO x3_direct_cycle_slots(cycle_id,slot_number,buyer_user_id,buyer_package_purchase_id,recipient_user_id,disposition,gross_amount,source_contract_event_id,transaction_hash,block_number,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[cycle.id,slot,input.userId,input.purchaseId,recipient,disposition,gross.toString(),input.sourceEventId,input.txHash,input.blockNumber,input.logIndex])).rows[0];
 await client.query(`INSERT INTO x3_direct_cycle_events(cycle_id,slot_id,event_type,idempotency_key,metadata) VALUES($1,$2,'SLOT_FILLED',$3,$4)`,[cycle.id,slotRow.id,`x3-direct:slot-filled:${input.purchaseId}`,JSON.stringify({slot,disposition})]);await creditOrHold(client,{slotId:slotRow.id,recipient,packageId:input.packageId,gross});
 if(slot===3){await client.query("UPDATE x3_direct_cycles SET status='COMPLETED',completed_at=transaction_timestamp() WHERE id=$1 AND status='ACTIVE'",[cycle.id]);await client.query(`INSERT INTO x3_direct_cycle_events(cycle_id,slot_id,event_type,idempotency_key) VALUES($1,$2,'CYCLE_COMPLETED',$3)`,[cycle.id,slotRow.id,`x3-direct:cycle-complete:${cycle.id}`]);await openCycle(client,sponsor.sponsor_user_id,input.packageId,cycle.cycle_number+1);}
 return{duplicate:false,cycleId:cycle.id,slot,recipient,disposition};
}
