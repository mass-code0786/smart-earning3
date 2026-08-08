import type{PoolClient}from"pg";
import{ApiError}from"./http";
import{smartEarningDeployment}from"@/lib/blockchain/deployment-metadata";
import{creditGrossEarning}from"./earning-split-service";
import{x3Allocation,X3_PACKAGE_PRICES}from"./x3-math";

type Input={purchaseId:string;userId:string;packageId:number;amount:bigint;txHash:string;blockNumber:number;sourceEventId:string;logIndex:number;onchain?:{buyer:string;owner:string;cycle:number;slot:number;recipient:string;disposition:number;packageAmount:bigint;gross:bigint}};

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

export async function ensureCurrentDirectX3Alignment(client:Pick<PoolClient,"query">){
 const deployment=smartEarningDeployment(),boundary=deployment.blockNumber-1;
 const result=await client.query(`INSERT INTO x3_direct_deployment_rollouts(
   chain_id,contract_address,deployment_block,boundary_block_number,boundary_log_index,mode
  ) VALUES($1,$2,$3,$4,-1,'CONTRACT_ALIGNED')
  ON CONFLICT(chain_id,contract_address) DO UPDATE SET
   deployment_block=EXCLUDED.deployment_block,boundary_block_number=EXCLUDED.boundary_block_number,
   boundary_log_index=-1,mode='CONTRACT_ALIGNED',activated_at=now()
  WHERE x3_direct_deployment_rollouts.deployment_block<>EXCLUDED.deployment_block
    OR x3_direct_deployment_rollouts.boundary_block_number<>EXCLUDED.boundary_block_number
    OR x3_direct_deployment_rollouts.boundary_log_index<>-1
    OR x3_direct_deployment_rollouts.mode<>'CONTRACT_ALIGNED'`,
  [deployment.chainId,deployment.address,deployment.blockNumber,boundary]);
 return Boolean(result.rowCount);
}

export async function isDirectX3Purchase(client:PoolClient,blockNumber:number,logIndex:number){const deployment=smartEarningDeployment();const r=(await client.query<{deployment_block:string;boundary_block_number:string;boundary_log_index:number;mode:string}>("SELECT deployment_block::text,boundary_block_number::text,boundary_log_index,mode FROM x3_direct_deployment_rollouts WHERE chain_id=$1 AND contract_address=$2",[deployment.chainId,deployment.address])).rows[0];if(!r||Number(r.deployment_block)!==deployment.blockNumber||Number(r.boundary_block_number)!==deployment.blockNumber-1||r.boundary_log_index!==-1||r.mode!=="CONTRACT_ALIGNED")throw new ApiError(503,"Direct X3 requires the aligned contract deployment","X3_CONTRACT_ALIGNMENT_REQUIRED");return blockNumber>Number(r.boundary_block_number)||(blockNumber===Number(r.boundary_block_number)&&logIndex>r.boundary_log_index)}

export async function processDirectX3PackagePurchase(client:PoolClient,input:Input){
 const expected=X3_PACKAGE_PRICES[input.packageId-1];if(!expected||expected.price!==input.amount)throw new ApiError(422,"X3 package amount mismatch","X3_AMOUNT_MISMATCH");
 const buyerWallet=(await client.query<{wallet_address:string}>("SELECT wallet_address FROM users WHERE id=$1",[input.userId])).rows[0]?.wallet_address;
 if(input.onchain&&(!buyerWallet||buyerWallet.toLowerCase()!==input.onchain.buyer||input.onchain.packageAmount!==input.amount||input.onchain.gross!==x3Allocation(input.amount).x3))throw new ApiError(409,"Direct X3 event does not match package evidence","X3_EVENT_MISMATCH");
 const duplicate=await client.query("SELECT id FROM x3_direct_cycle_slots WHERE buyer_package_purchase_id=$1",[input.purchaseId]);if(duplicate.rowCount)return{duplicate:true};
 const sponsor=(await client.query<{sponsor_user_id:string}>("SELECT sponsor_user_id FROM referral_relations WHERE user_id=$1",[input.userId])).rows[0];
 if(!sponsor){if(input.onchain&&(input.onchain.owner!=="0x0000000000000000000000000000000000000000"||input.onchain.cycle!==0||input.onchain.slot!==0||input.onchain.recipient!=="0x0000000000000000000000000000000000000000"||input.onchain.disposition!==2))throw new ApiError(409,"Direct X3 genesis event mismatch","X3_EVENT_MISMATCH");return{duplicate:false,genesisBuyer:true};}
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`x3-direct:${sponsor.sponsor_user_id}:${input.packageId}`]);
 let cycle=(await client.query<{id:string;cycle_number:number}>("SELECT id,cycle_number FROM x3_direct_cycles WHERE owner_user_id=$1 AND package_id=$2 AND status='ACTIVE' FOR UPDATE",[sponsor.sponsor_user_id,input.packageId])).rows[0];
 if(!cycle){const n=Number((await client.query<{n:string}>("SELECT COALESCE(max(cycle_number),0)+1 n FROM x3_direct_cycles WHERE owner_user_id=$1 AND package_id=$2",[sponsor.sponsor_user_id,input.packageId])).rows[0].n);cycle={id:await openCycle(client,sponsor.sponsor_user_id,input.packageId,n),cycle_number:n};}
 const count=Number((await client.query<{n:string}>("SELECT count(*) n FROM x3_direct_cycle_slots WHERE cycle_id=$1",[cycle.id])).rows[0].n),slot=count+1;if(slot>3)throw new ApiError(409,"Direct X3 cycle is already full","X3_DIRECT_CYCLE_FULL");
 let recipient:string|null=sponsor.sponsor_user_id,disposition='OWNER_INCOME';if(slot===3){const up=(await client.query<{sponsor_user_id:string}>("SELECT sponsor_user_id FROM referral_relations WHERE user_id=$1",[sponsor.sponsor_user_id])).rows[0];recipient=up?.sponsor_user_id||null;disposition=recipient?'PASS_UP':'GENESIS_RETAINED';}
 const ownerWallet=(await client.query<{wallet_address:string}>("SELECT wallet_address FROM users WHERE id=$1",[sponsor.sponsor_user_id])).rows[0]?.wallet_address?.toLowerCase();
 const recipientWallet=recipient?(await client.query<{wallet_address:string}>("SELECT wallet_address FROM users WHERE id=$1",[recipient])).rows[0]?.wallet_address?.toLowerCase():"0x0000000000000000000000000000000000000000";
 const dispositionNumber=disposition==='OWNER_INCOME'?0:disposition==='PASS_UP'?1:2;
 if(input.onchain&&(ownerWallet!==input.onchain.owner||cycle.cycle_number!==input.onchain.cycle||slot!==input.onchain.slot||recipientWallet!==input.onchain.recipient||dispositionNumber!==input.onchain.disposition))throw new ApiError(409,"Direct X3 event does not match indexed referral state","X3_EVENT_MISMATCH");
 const gross=x3Allocation(input.amount).x3,slotRow=(await client.query<{id:string}>(`INSERT INTO x3_direct_cycle_slots(cycle_id,slot_number,buyer_user_id,buyer_package_purchase_id,recipient_user_id,disposition,gross_amount,source_contract_event_id,transaction_hash,block_number,log_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[cycle.id,slot,input.userId,input.purchaseId,recipient,disposition,gross.toString(),input.sourceEventId,input.txHash,input.blockNumber,input.logIndex])).rows[0];
 await client.query(`INSERT INTO x3_direct_cycle_events(cycle_id,slot_id,event_type,idempotency_key,metadata) VALUES($1,$2,'SLOT_FILLED',$3,$4)`,[cycle.id,slotRow.id,`x3-direct:slot-filled:${input.purchaseId}`,JSON.stringify({slot,disposition})]);await creditOrHold(client,{slotId:slotRow.id,recipient,packageId:input.packageId,gross});
 if(slot===3){await client.query("UPDATE x3_direct_cycles SET status='COMPLETED',completed_at=transaction_timestamp() WHERE id=$1 AND status='ACTIVE'",[cycle.id]);await client.query(`INSERT INTO x3_direct_cycle_events(cycle_id,slot_id,event_type,idempotency_key) VALUES($1,$2,'CYCLE_COMPLETED',$3)`,[cycle.id,slotRow.id,`x3-direct:cycle-complete:${cycle.id}`]);await openCycle(client,sponsor.sponsor_user_id,input.packageId,cycle.cycle_number+1);}
 return{duplicate:false,cycleId:cycle.id,slot,recipient,disposition};
}
