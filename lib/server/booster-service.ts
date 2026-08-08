import{randomUUID}from"node:crypto";
import{Contract,Interface,keccak256,toUtf8Bytes}from"ethers";
import type{PoolClient}from"pg";
import{getProvider}from"@/lib/blockchain/provider";
import{normalizeWallet}from"./auth";
import{CHAIN_ID,getServerConfig}from"./config";
import{query,transaction,getPool}from"./db";
import{ApiError}from"./http";
import{creditGrossEarning}from"./earning-split-service";
import{BOOSTER_ENTRY_COST,BOOSTER_INCOME,BOOSTER_INTERVAL_MS,boosterPackageCredit}from"./booster-math";
import{createAutopoolEntryForBooster}from"./autopool-service";

const transferInterface=new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const boosterTopUpInterface=new Interface([
  "event BoosterTopup(address indexed user,uint256 amount,bytes32 indexed sourceReference)",
  "event TreasuryFunded(address indexed user,bytes32 indexed paymentType,uint256 grossAmount,uint256 treasuryAmount,bytes32 sourceReference,uint256 timestamp)",
]);
const TX=/^0x[a-fA-F0-9]{64}$/;
const workerInstance=`node-${process.pid}-${randomUUID().slice(0,8)}`;
export function findBoosterTransfer(logs:readonly{address:string;topics:readonly string[];data:string}[],
  token:string,sender:string,recipient:string){
  let amount:bigint|null=null;
  for(const log of logs){
    if(normalizeWallet(log.address)!==normalizeWallet(token))continue;
    try{const event=transferInterface.parseLog({topics:[...log.topics],data:log.data});
      if(event?.name==="Transfer"&&normalizeWallet(String(event.args.from))===normalizeWallet(sender)
        &&normalizeWallet(String(event.args.to))===normalizeWallet(recipient))amount=(amount||0n)+BigInt(event.args.value)}catch{}
  }return amount;
}

export function findConfirmedBoosterTopUp(logs:readonly{address:string;topics:readonly string[];data:string}[],
  contractAddress:string,user:string){
  let topUp:{amount:bigint;sourceReference:string}|null=null;
  let treasury:{amount:bigint;sourceReference:string}|null=null;
  for(const log of logs){
    if(normalizeWallet(log.address)!==normalizeWallet(contractAddress))continue;
    try{
      const event=boosterTopUpInterface.parseLog({topics:[...log.topics],data:log.data});
      if(event?.name==="BoosterTopup"&&normalizeWallet(String(event.args.user))===normalizeWallet(user))
        topUp={amount:BigInt(event.args.amount),sourceReference:String(event.args.sourceReference).toLowerCase()};
      if(event?.name==="TreasuryFunded"&&normalizeWallet(String(event.args.user))===normalizeWallet(user)
        &&String(event.args.paymentType).toLowerCase()===keccak256(toUtf8Bytes("BOOSTER_TOP_UP")).toLowerCase()){
        treasury={amount:BigInt(event.args.treasuryAmount),sourceReference:String(event.args.sourceReference).toLowerCase()};
      }
    }catch{}
  }
  return{topUp,treasury};
}

async function audit(client:PoolClient,event:string,key:string,input:{
  userId?:string;entryId?:string;positionId?:string;metadata?:Record<string,unknown>;
}={}){
  await client.query(`INSERT INTO booster_audit_logs(
    event_type,user_id,entry_id,position_id,idempotency_key,metadata
  ) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING`,
  [event,input.userId||null,input.entryId||null,input.positionId||null,key,JSON.stringify(input.metadata||{})]);
}

export async function creditBoosterPackagePurchase(client:PoolClient,input:{
  purchaseId:string;userId:string;packageId:number;amount:bigint;txHash:string;
}){
  const amount=boosterPackageCredit(input.amount),key=`booster:package:${input.purchaseId}`;
  await client.query("INSERT INTO booster_memberships(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[input.userId]);
  const result=await client.query<{id:string}>(
    `INSERT INTO booster_wallet_ledger(
      user_id,direction,amount_token_units,reason,package_purchase_id,idempotency_key,metadata
    ) VALUES($1,'CREDIT',$2,'PACKAGE_CREDIT',$3,$4,$5)
    ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [input.userId,amount.toString(),input.purchaseId,key,JSON.stringify({packageId:input.packageId,txHash:input.txHash})],
  );
  await audit(client,"PACKAGE_CREDIT",`booster:audit:package:${input.purchaseId}`,
    {userId:input.userId,metadata:{packageId:input.packageId,amount:amount.toString()}});
  return{amount,duplicate:!result.rows[0]};
}

async function walletBalance(client:PoolClient,userId:string){
  const row=(await client.query<{balance:string}>(
    `SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text balance
     FROM booster_wallet_ledger WHERE user_id=$1`,[userId],
  )).rows[0];
  return BigInt(row.balance);
}

async function placeEntry(client:PoolClient,entry:{id:string;owner_user_id:string}){
  await client.query("SELECT pg_advisory_xact_lock(hashtext('booster:global-queue'))");
  const sequence=(await client.query<{value:string}>(
    "SELECT COALESCE(max(queue_sequence),0)+1 value FROM booster_global_queue",
  )).rows[0].value;
  await client.query("INSERT INTO booster_global_queue(entry_id,queue_sequence) VALUES($1,$2)",[entry.id,sequence]);
  const receiver=(await client.query<{id:string;owner_user_id:string;count:number}>(
    `SELECT e.id,e.owner_user_id,count(p.id)::int count
     FROM booster_global_queue q JOIN booster_entries e ON e.id=q.entry_id
     LEFT JOIN booster_positions p ON p.owner_entry_id=e.id
     WHERE q.status='WAITING' AND e.id<>$1
     GROUP BY q.queue_sequence,e.id HAVING count(p.id)<3
     ORDER BY q.queue_sequence LIMIT 1`,[entry.id],
  )).rows[0];
  if(!receiver){
    await audit(client,"ROOT_ENTRY",`booster:root:${entry.id}`,{userId:entry.owner_user_id,entryId:entry.id});
    return;
  }
  const slot=receiver.count+1;
  const position=(await client.query<{id:string}>(
    `INSERT INTO booster_positions(owner_entry_id,slot_number,placed_entry_id,placed_user_id,idempotency_key)
     VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [receiver.id,slot,entry.id,entry.owner_user_id,`booster:position:${entry.id}`],
  )).rows[0];
  await client.query("UPDATE booster_entries SET parent_entry_id=$2,placement_slot=$3 WHERE id=$1",[entry.id,receiver.id,slot]);
  if(slot<=2){
    const credit=await creditGrossEarning({userId:receiver.owner_user_id,incomeType:"BOOSTER",
      sourceReference:position.id,grossAmount:BOOSTER_INCOME,idempotencyKey:`booster:income-cap:${position.id}`},client);
    await client.query(`INSERT INTO booster_income_history(
      owner_user_id,source_user_id,owner_entry_id,position_id,slot_number,gross_amount,
      credited_amount,excess_amount,income_credit_ledger_id,idempotency_key
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [receiver.owner_user_id,entry.owner_user_id,receiver.id,position.id,slot,BOOSTER_INCOME.toString(),
      credit.credited.toString(),credit.excess.toString(),credit.ledgerId,`booster:income:${position.id}`]);
  }else{
    await client.query(`INSERT INTO booster_wallet_ledger(
      user_id,direction,amount_token_units,reason,entry_id,position_id,idempotency_key
    ) VALUES($1,'CREDIT',$2,'C_POSITION_REFUND',$3,$4,$5)`,
    [receiver.owner_user_id,BOOSTER_ENTRY_COST.toString(),receiver.id,position.id,`booster:refund:${position.id}`]);
    await client.query("UPDATE booster_entries SET status='COMPLETED',completed_at=now() WHERE id=$1",[receiver.id]);
    await client.query("UPDATE booster_global_queue SET status='FILLED',completed_at=now() WHERE entry_id=$1",[receiver.id]);
  }
  await audit(client,"POSITION_FILLED",`booster:audit:position:${position.id}`,
    {userId:receiver.owner_user_id,entryId:receiver.id,positionId:position.id,metadata:{slot}});
}

export async function processBoosterUser(userId:string,now=new Date(),existingClient?:PoolClient){
  const execute=async(client:PoolClient)=>{
    const member=(await client.query<{last_entry_at:Date|null;next_entry_at:Date;created_at:Date}>(
      "SELECT last_entry_at,next_entry_at,created_at FROM booster_memberships WHERE user_id=$1 FOR UPDATE",[userId],
    )).rows[0];
    if(!member||member.next_entry_at>now)return{status:"NOT_DUE" as const};
    const scheduledFor=member.next_entry_at;
    const existing=await client.query("SELECT 1 FROM booster_scheduler_history WHERE user_id=$1 AND scheduled_for=$2",[userId,scheduledFor]);
    if(existing.rowCount)return{status:"DUPLICATE" as const};
    const balance=await walletBalance(client,userId);
    if(balance<BOOSTER_ENTRY_COST){
      await client.query(`INSERT INTO booster_scheduler_history(user_id,scheduled_for,status,worker_instance)
        VALUES($1,$2,'INSUFFICIENT',$3)`,[userId,scheduledFor,workerInstance]);
      await client.query("UPDATE booster_memberships SET next_entry_at=$2,updated_at=now() WHERE user_id=$1",
        [userId,new Date(now.getTime()+BOOSTER_INTERVAL_MS)]);
      return{status:"INSUFFICIENT" as const};
    }
    const history=(await client.query<{id:string}>(
      `INSERT INTO booster_scheduler_history(user_id,scheduled_for,status,worker_instance)
       VALUES($1,$2,'COMPLETED',$3) RETURNING id`,[userId,scheduledFor,workerInstance],
    )).rows[0];
    const cycle=(await client.query<{value:number}>(
      "SELECT COALESCE(max(cycle_number),0)::int+1 value FROM booster_entries WHERE owner_user_id=$1",[userId],
    )).rows[0].value;
    const entry=(await client.query<{id:string;owner_user_id:string}>(
      `INSERT INTO booster_entries(owner_user_id,cycle_number,scheduler_history_id)
       VALUES($1,$2,$3) RETURNING id,owner_user_id`,[userId,cycle,history.id],
    )).rows[0];
    await client.query(`INSERT INTO booster_wallet_ledger(
      user_id,direction,amount_token_units,reason,entry_id,idempotency_key
    ) VALUES($1,'DEBIT',$2,'ENTRY_DEDUCTION',$3,$4)`,
    [userId,BOOSTER_ENTRY_COST.toString(),entry.id,`booster:deduction:${history.id}`]);
    await placeEntry(client,entry);
    await createAutopoolEntryForBooster(client,{boosterEntryId:entry.id,userId});
    await client.query("UPDATE booster_memberships SET last_entry_at=$2,next_entry_at=$3,updated_at=now() WHERE user_id=$1",
      [userId,now,new Date(now.getTime()+BOOSTER_INTERVAL_MS)]);
    return{status:"COMPLETED" as const,entryId:entry.id};
  };
  return existingClient?execute(existingClient):transaction(execute);
}

export async function runBoosterScheduler(limit=100){
  const users=(await query<{user_id:string}>(
    "SELECT user_id FROM booster_memberships WHERE next_entry_at<=now() ORDER BY next_entry_at LIMIT $1",[limit],
  )).rows;
  const results=[];for(const row of users){
    try{results.push({userId:row.user_id,...await processBoosterUser(row.user_id)})}
    catch(error){
      await query(`INSERT INTO booster_scheduler_history(user_id,scheduled_for,status,worker_instance,error_code,error_message)
        VALUES($1,now(),'FAILED',$2,'PROCESSING_FAILED',$3) ON CONFLICT(user_id,scheduled_for) DO NOTHING`,
      [row.user_id,workerInstance,error instanceof Error?error.message.slice(0,500):"Unknown error"]).catch(()=>undefined);
      results.push({userId:row.user_id,status:"FAILED" as const});
    }
  }return results;
}

export async function withBoosterWorkerLock<T>(operation:()=>Promise<T>){
  const client=await getPool().connect();
  const locked=Boolean((await client.query<{ok:boolean}>(
    "SELECT pg_try_advisory_lock(hashtext('booster:scheduler:worker')) ok")).rows[0].ok);
  if(!locked){client.release();return null}
  try{return await operation()}finally{await client.query("SELECT pg_advisory_unlock(hashtext('booster:scheduler:worker'))");client.release()}
}

export async function verifyBoosterTopUp(walletInput:string,txHashInput:string,expectedAmount:bigint){
  const wallet=normalizeWallet(walletInput),txHash=txHashInput.toLowerCase();
  if(!TX.test(txHash)||expectedAmount<=0n)throw new ApiError(400,"Invalid Booster Wallet top-up request","INVALID_TOP_UP");
  const config=getServerConfig(),provider=getProvider();
  const[receipt,tx,network,head]=await Promise.all([
    provider.getTransactionReceipt(txHash),provider.getTransaction(txHash),provider.getNetwork(),provider.getBlockNumber(),
  ]);
  if(Number(network.chainId)!==CHAIN_ID)throw new ApiError(503,"RPC is connected to the wrong network","WRONG_RPC_NETWORK");
  if(!receipt||!tx)throw new ApiError(409,"Transaction is not mined yet","TX_PENDING");
  if(receipt.status!==1)throw new ApiError(422,"Transaction reverted","TX_REVERTED");
  if(normalizeWallet(tx.from)!==wallet)throw new ApiError(403,"Transaction belongs to another wallet","WALLET_MISMATCH");
  if(normalizeWallet(receipt.to||"")!==normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS))
    throw new ApiError(422,"Transaction does not use the unified Smart Earning contract","WRONG_CONTRACT");
  const contractAddress=normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS);
  const treasuryAddress=normalizeWallet(String(await new Contract(
    contractAddress,["function treasuryWallet() view returns(address)"],provider).treasuryWallet()));
  const transferred=findBoosterTransfer(receipt.logs,config.BSC_TESTNET_USDT_ADDRESS,wallet,contractAddress);
  const forwarded=findBoosterTransfer(receipt.logs,config.BSC_TESTNET_USDT_ADDRESS,contractAddress,treasuryAddress);
  const evidence=findConfirmedBoosterTopUp(receipt.logs,contractAddress,wallet);
  if(!evidence.topUp)throw new ApiError(422,"Confirmed Booster top-up event was not found","TOP_UP_EVENT_NOT_FOUND");
  const topUpEvidence=evidence.topUp;
  if(!evidence.treasury||evidence.treasury.sourceReference!==evidence.topUp.sourceReference
    ||evidence.treasury.amount!==expectedAmount)
    throw new ApiError(422,"Treasury forwarding event does not match the Booster top-up","TREASURY_EVENT_MISMATCH");
  if(transferred===null)throw new ApiError(422,"USDT transfer to the unified contract was not found","TRANSFER_NOT_FOUND");
  if(forwarded===null)throw new ApiError(422,"Treasury forwarding was not found","TREASURY_FORWARD_NOT_FOUND");
  if(transferred!==expectedAmount||evidence.topUp.amount!==expectedAmount)
    throw new ApiError(422,"Booster Wallet top-up amount does not match","WRONG_AMOUNT");
  if(forwarded!==expectedAmount)
    throw new ApiError(422,"Full Booster top-up was not forwarded to treasury","TREASURY_FORWARD_AMOUNT_MISMATCH");
  const confirmations=head-receipt.blockNumber+1;
  if(confirmations<config.CONFIRMATIONS_REQUIRED)throw new ApiError(409,"Waiting for blockchain confirmations","CONFIRMATIONS_PENDING");
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`booster:top-up:${txHash}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",
      [`booster:top-up-source:${topUpEvidence.sourceReference}`]);
    const duplicate=await client.query<{id:string}>(
      "SELECT id FROM booster_top_up_history WHERE tx_hash=$1 OR source_reference=$2",
      [txHash,topUpEvidence.sourceReference]);
    if(duplicate.rows[0])return{topUpId:duplicate.rows[0].id,duplicate:true};
    const user=(await client.query<{id:string}>("SELECT id FROM users WHERE wallet_address=$1 AND status='ACTIVE'",[wallet])).rows[0];
    if(!user)throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`booster:top-up-user:${user.id}`]);
    await client.query("INSERT INTO booster_memberships(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[user.id]);
    const previousBalance=BigInt(String((await client.query<{balance:string}>(`SELECT COALESCE(sum(
      CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)::text balance
      FROM booster_wallet_ledger WHERE user_id=$1`,[user.id])).rows[0].balance));
    const newBalance=previousBalance+expectedAmount;
    const topUp=(await client.query<{id:string}>(`INSERT INTO booster_top_up_history(
      user_id,tx_hash,token_address,sender_address,recipient_address,amount_token_units,block_number,confirmations,
      source_reference,status,treasury_address,treasury_amount_token_units
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMED',$10,$6) RETURNING id`,
    [user.id,txHash,normalizeWallet(config.BSC_TESTNET_USDT_ADDRESS),wallet,contractAddress,
      expectedAmount.toString(),receipt.blockNumber,confirmations,topUpEvidence.sourceReference,treasuryAddress])).rows[0];
    await client.query(`INSERT INTO booster_wallet_ledger(
      user_id,direction,amount_token_units,reason,top_up_id,idempotency_key,metadata
    ) VALUES($1,'CREDIT',$2,'MANUAL_TOP_UP',$3,$4,$5)`,
    [user.id,expectedAmount.toString(),topUp.id,`booster:top-up:${topUpEvidence.sourceReference}`,
      JSON.stringify({txHash,sourceReference:topUpEvidence.sourceReference,status:"CONFIRMED",
        previousBalance:previousBalance.toString(),newBalance:newBalance.toString()})]);
    await audit(client,"MANUAL_TOP_UP",`booster:audit:top-up:${topUpEvidence.sourceReference}`,
      {userId:user.id,metadata:{amount:expectedAmount.toString(),txHash,sourceReference:topUpEvidence.sourceReference}});
    return{topUpId:topUp.id,duplicate:false,previousBalance:previousBalance.toString(),newBalance:newBalance.toString()};
  });
}

export async function prepareBoosterTopUp(walletInput:string,amount:bigint){
  const wallet=normalizeWallet(walletInput);
  if(amount<=0n)throw new ApiError(400,"Top-up amount must be greater than zero","INVALID_TOP_UP");
  const config=getServerConfig(),provider=getProvider();
  const network=await provider.getNetwork();
  if(Number(network.chainId)!==CHAIN_ID)throw new ApiError(503,"RPC is connected to the wrong network","WRONG_RPC_NETWORK");
  const user=(await query<{id:string}>("SELECT id FROM users WHERE wallet_address=$1 AND status='ACTIVE'",[wallet])).rows[0];
  if(!user)throw new ApiError(404,"User is not indexed","USER_NOT_FOUND");
  const token=new Contract(config.BSC_TESTNET_USDT_ADDRESS,["function balanceOf(address) view returns(uint256)"],provider);
  const availableBalance=BigInt(await token.balanceOf(wallet));
  if(amount>availableBalance)throw new ApiError(422,"Top-up amount exceeds available USDT balance","INSUFFICIENT_USDT");
  return{amountTokenUnits:amount.toString(),availableBalanceTokenUnits:availableBalance.toString(),
    network:process.env.NEXT_PUBLIC_NETWORK_NAME||`Chain ${CHAIN_ID}`,chainId:CHAIN_ID,
    gasCurrency:process.env.NEXT_PUBLIC_NATIVE_CURRENCY_SYMBOL||"NATIVE"};
}
