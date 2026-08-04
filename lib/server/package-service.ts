import { Interface } from "ethers";
import { PACKAGE_ABI } from "@/lib/blockchain/abi";
import { getPackageContract, getProvider } from "@/lib/blockchain/provider";
import { CHAIN_ID, getServerConfig } from "./config";
import { normalizeWallet } from "./auth";
import { ApiError } from "./http";
import { query, transaction } from "./db";
import { processX3PackagePurchase } from "./x3-service";
import { processX4PackagePurchase } from "./x4-service";
import { creditBoosterPackagePurchase } from "./booster-service";
import { createDividendPackageTracker } from "./dividend-service";
import { recordConfirmedMagicFunding } from "./earning-split-service";
import { solidityPackedKeccak256 } from "ethers";
import { assertModuleActive, isModulePaused } from "./module-control-service";

const iface = new Interface(PACKAGE_ABI);
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

export const PACKAGE_CATALOGUE = [8n,16n,32n,64n,128n,256n,512n,1024n].map(
  (dollars, index) => ({ packageId: index + 1, name: `${index + 1}${index===0?"st":index===1?"nd":index===2?"rd":"th"} Package`, dollars }),
);

async function recordAttempt(
  wallet:string, txHash:string, packageId:number, amount:bigint, status:string, reason?:string,
) {
  await query(
    `INSERT INTO package_purchase_attempts(
      user_id,wallet_address,package_id,amount_token_units,tx_hash,status,reason
    ) SELECT id,$1,$2,$3,$4,$5,$6 FROM users WHERE wallet_address=$1
    ON CONFLICT(tx_hash,status) DO NOTHING`,
    [wallet,packageId,amount.toString(),txHash,status,reason||null],
  );
}

export async function getPackageDashboard(walletInput: string) {
  const wallet = normalizeWallet(walletInput);
  const contract = getPackageContract();
  const [
    registered, nextPackage, purchased, totalPackageValue, totalEligibleValue,
    totalEarningCap, totalEarned, remainingCap, cappingStatus,
  ] = await Promise.all([
    contract.registered(wallet),
    contract.getNextPackage(wallet),
    contract.getPurchasedPackages(wallet),
    contract.getTotalPackageValue(wallet),
    contract.getTotalEligibleValue(wallet),
    contract.getTotalEarningCap(wallet),
    contract.getTotalEarned(wallet),
    contract.getRemainingEarningCap(wallet),
    contract.getCappingStatus(wallet),
  ]);
  const decimals = 6;
  const attempt = await query<{ package_id:number;status:string }>(
    `SELECT package_id,status FROM package_purchase_attempts
     WHERE wallet_address=$1 AND status IN ('PENDING','FAILED')
     ORDER BY created_at DESC LIMIT 1`,
    [wallet],
  );
  const latestAttempt = attempt.rows[0];
  return {
    wallet,
    registered: Boolean(registered),
    nextPackage: Number(nextPackage),
    packages: PACKAGE_CATALOGUE.map((item, index) => ({
      packageId: item.packageId,
      name: item.name,
      priceTokenUnits: (item.dollars * 10n ** BigInt(decimals)).toString(),
      capAdditionTokenUnits: (item.dollars * 5n * 10n ** BigInt(decimals)).toString(),
      magicAllocationTokenUnits: (item.dollars * 10n ** BigInt(decimals) / 8n).toString(),
      status: purchased[index] ? "PURCHASED"
        : Number(nextPackage) === item.packageId && latestAttempt?.package_id === item.packageId
          ? latestAttempt.status
          : Number(nextPackage) === item.packageId ? "AVAILABLE" : "LOCKED",
    })),
    totalPackageValue: totalPackageValue.toString(),
    registrationValue: registered ? (2n * 10n ** BigInt(decimals)).toString() : "0",
    totalEligibleValue: totalEligibleValue.toString(),
    totalEarningCap: totalEarningCap.toString(),
    totalEarned: totalEarned.toString(),
    remainingCap: remainingCap.toString(),
    cappingStatus: ["ACTIVE","NEAR_CAP","CAPPED"][Number(cappingStatus)] || "CAPPED",
    modulePauses: {
      packagePurchase: await isModulePaused("PACKAGE_PURCHASE"),
      x3Placement: await isModulePaused("X3_PLACEMENT"),
      x4Placement: await isModulePaused("X4_PLACEMENT"),
    },
  };
}

export async function verifyPackagePurchase(walletInput: string, txHashInput: string) {
  const wallet = normalizeWallet(walletInput);
  const txHash = txHashInput.toLowerCase();
  if (!TX_HASH.test(txHash)) throw new ApiError(400, "Invalid transaction hash", "INVALID_TX_HASH");
  const config = getServerConfig();
  const provider = getProvider();
  const [receipt, tx, head] = await Promise.all([
    provider.getTransactionReceipt(txHash), provider.getTransaction(txHash), provider.getBlockNumber(),
  ]);
  if (!tx) throw new ApiError(404, "Transaction was not found", "TX_NOT_FOUND");
  if (normalizeWallet(tx.from) !== wallet) throw new ApiError(403, "Transaction belongs to another wallet", "WALLET_MISMATCH");
  if (normalizeWallet(tx.to || "") !== normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS)) {
    throw new ApiError(422, "Transaction targets another contract", "WRONG_CONTRACT");
  }
  let decoded;
  try { decoded = iface.parseTransaction({ data: tx.data, value: tx.value }); } catch { decoded = null; }
  if (!decoded || decoded.name !== "purchasePackage") {
    throw new ApiError(422, "Transaction is not a package purchase", "WRONG_METHOD");
  }
  const requestedPackage = Number(decoded.args.packageId);
  const requestedAmount = BigInt(decoded.args.amount);
  const expectedAmount = PACKAGE_CATALOGUE[requestedPackage - 1]?.dollars * 1_000_000n;
  if (!expectedAmount || requestedAmount !== expectedAmount) {
    throw new ApiError(422, "Package amount is incorrect", "WRONG_PACKAGE_AMOUNT");
  }
  if (!receipt) {
    await recordAttempt(wallet,txHash,requestedPackage,requestedAmount,"PENDING");
    throw new ApiError(409, "Package transaction is pending", "TX_PENDING");
  }
  if (receipt.status !== 1) {
    await recordAttempt(wallet,txHash,requestedPackage,requestedAmount,"FAILED","Transaction reverted");
    throw new ApiError(422, "Package transaction reverted", "TX_REVERTED");
  }
  const confirmations = head - receipt.blockNumber + 1;
  if (confirmations < config.CONFIRMATIONS_REQUIRED) {
    throw new ApiError(409, "Waiting for blockchain confirmations", "CONFIRMATIONS_PENDING");
  }
  const confirmedBlock=await provider.getBlock(receipt.blockNumber);
  if(!confirmedBlock||confirmedBlock.hash?.toLowerCase()!==receipt.blockHash.toLowerCase()){
    throw new ApiError(409,"Confirmed package block could not be validated","BLOCK_VALIDATION_FAILED");
  }
  const confirmedBlockAt=new Date(confirmedBlock.timestamp*1000);
  if(!Number.isFinite(confirmedBlockAt.getTime())||confirmedBlockAt.getTime()>Date.now()+5*60_000){
    throw new ApiError(422,"Confirmed package block timestamp is invalid","BLOCK_TIMESTAMP_INVALID");
  }
  const packageLog = receipt.logs.map((log) => {
    try { return { log, event: iface.parseLog(log) }; } catch { return null; }
  }).find((item) => item?.event?.name === "PackagePurchased");
  if (!packageLog?.event) throw new ApiError(422, "PackagePurchased event was not found", "EVENT_NOT_FOUND");
  const eventWallet = normalizeWallet(String(packageLog.event.args.user));
  const packageId = Number(packageLog.event.args.packageId);
  const amount = BigInt(packageLog.event.args.amount);
  const totalPackageValue = BigInt(packageLog.event.args.totalPackageValue);
  const newCap = BigInt(packageLog.event.args.newEarningCap);
  if (eventWallet !== wallet) throw new ApiError(403, "Event belongs to another wallet", "WALLET_MISMATCH");
  if (packageId !== requestedPackage) throw new ApiError(422, "Package event ID is incorrect", "WRONG_PACKAGE_ID");
  if (amount !== expectedAmount) throw new ApiError(422, "Package event amount is incorrect", "WRONG_PACKAGE_AMOUNT");

  return transaction(async (client) => {
    await assertModuleActive("PACKAGE_PURCHASE",client);
    await assertModuleActive("X3_PLACEMENT",client);
    await assertModuleActive("X4_PLACEMENT",client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`package:${txHash}`]);
    const duplicate = await client.query<{ id:string;status:string }>(
      "SELECT id,status FROM package_purchases WHERE tx_hash=$1", [txHash],
    );
    if (duplicate.rows[0]) {
      await client.query(
        `INSERT INTO package_purchase_attempts(user_id,wallet_address,package_id,amount_token_units,tx_hash,status,reason)
         SELECT id,$1,$2,$3,$4,'DUPLICATE','Already indexed' FROM users WHERE wallet_address=$1
         ON CONFLICT(tx_hash,status) DO NOTHING`,
        [wallet,packageId,amount.toString(),txHash],
      );
      return { purchaseId: duplicate.rows[0].id, status: duplicate.rows[0].status, duplicate: true };
    }
    const userResult = await client.query<{ id:string }>(
      "SELECT id FROM users WHERE wallet_address=$1 AND status='ACTIVE' FOR UPDATE", [wallet],
    );
    if (!userResult.rows[0]) throw new ApiError(422, "Registered wallet is not indexed", "REGISTRATION_NOT_INDEXED");
    const userId = userResult.rows[0].id;
    const state = await client.query<{highest_package_id:number;total_earning_cap:string}>(
      "SELECT highest_package_id,total_earning_cap::text FROM user_package_states WHERE user_id=$1 FOR UPDATE", [userId],
    );
    if (!state.rows[0]) throw new ApiError(409, "Package state is not initialized", "PACKAGE_STATE_MISSING");
    if (state.rows[0].highest_package_id + 1 !== packageId) {
      throw new ApiError(409, "Package sequence does not match indexed state", "PACKAGE_SEQUENCE_MISMATCH");
    }
    const definition = await client.query<{id:string}>(
      "SELECT id FROM package_definitions WHERE serial_number=$1 AND price_token_units=$2 AND is_active=true",
      [packageId, amount.toString()],
    );
    if (!definition.rows[0]) throw new ApiError(422, "Package definition mismatch", "PACKAGE_DEFINITION_MISMATCH");
    const purchase = await client.query<{id:string}>(
      `INSERT INTO package_purchases(
        user_id,wallet_address,package_definition_id,package_id,amount_token_units,
        tx_hash,block_number,status,purchased_at,confirmed_block_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',$8,$8) RETURNING id`,
      [userId,wallet,definition.rows[0].id,packageId,amount.toString(),txHash,receipt.blockNumber,confirmedBlockAt],
    );
    await client.query(
      `UPDATE user_package_states SET highest_package_id=$2,total_package_value=$3,
       total_eligible_value=registration_value+$3,total_earning_cap=$4,
       remaining_cap=GREATEST($4-total_earned,0),
       capping_status=CASE WHEN total_earned >= $4 THEN 'CAPPED'
         WHEN total_earned*100 >= $4*90 THEN 'NEAR_CAP' ELSE 'ACTIVE' END,
       updated_at=now() WHERE user_id=$1`,
      [userId,packageId,totalPackageValue.toString(),newCap.toString()],
    );
    await client.query(
      `INSERT INTO package_purchase_attempts(
        user_id,wallet_address,package_id,amount_token_units,tx_hash,status
       ) VALUES($1,$2,$3,$4,$5,'CONFIRMED')
       ON CONFLICT(tx_hash,status) DO NOTHING`,
      [userId,wallet,packageId,amount.toString(),txHash],
    );
    await client.query(
      `INSERT INTO earning_cap_ledger(
        user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
       ) VALUES($1,'PACKAGE_PURCHASE',$2,$3,$4,$5)`,
      [userId,purchase.rows[0].id,amount.toString(),(amount*5n).toString(),newCap.toString()],
    );
    const contractEvent = await client.query<{id:string}>(
      `INSERT INTO contract_events(
        chain_id,contract_address,tx_hash,log_index,block_number,block_hash,event_name,payload
       ) VALUES($1,$2,$3,$4,$5,$6,'PackagePurchased',$7) RETURNING id`,
      [CHAIN_ID,normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS),txHash,packageLog.log.index,receipt.blockNumber,receipt.blockHash,JSON.stringify({wallet,packageId,amount:amount.toString(),totalPackageValue:totalPackageValue.toString(),newCap:newCap.toString()})],
    );
    await processX3PackagePurchase(client,{
      purchaseId:purchase.rows[0].id,userId,packageId,amount,txHash,
      blockNumber:receipt.blockNumber,sourceEventId:contractEvent.rows[0].id,upgradeTimestamp:confirmedBlockAt,
    });
    await processX4PackagePurchase(client,{
      purchaseId:purchase.rows[0].id,userId,packageId,amount,txHash,
      blockNumber:receipt.blockNumber,sourceEventId:contractEvent.rows[0].id,
    });
    await creditBoosterPackagePurchase(client,{purchaseId:purchase.rows[0].id,userId,
      packageId,amount,txHash});
    await recordConfirmedMagicFunding(client,{userId,sourceType:"PACKAGE_PURCHASE",
      sourceReference:solidityPackedKeccak256(["string","address","uint8"],["PACKAGE",wallet,packageId]),
      amount:amount/8n,reason:"PACKAGE_MAGIC_12_5_PERCENT",idempotencyKey:`package:magic:${purchase.rows[0].id}`,txHash});
    await createDividendPackageTracker(client,{purchaseId:purchase.rows[0].id,userId,amount});
    return { purchaseId: purchase.rows[0].id, status: "CONFIRMED", duplicate: false, packageId };
  });
}

export async function adminPackageReport(search?: string) {
  const term = search?.trim() || null;
  const [totals, byPackage, users, transactions] = await Promise.all([
    query(`SELECT
      count(DISTINCT user_id)::int buyers,
      COALESCE(sum(amount_token_units) FILTER(WHERE status='CONFIRMED'),0)::text total_volume,
      (SELECT count(*)::int FROM package_purchase_attempts WHERE status='PENDING') pending,
      (SELECT count(*)::int FROM package_purchase_attempts WHERE status='FAILED') failed,
      (SELECT count(*)::int FROM package_purchase_attempts WHERE status='DUPLICATE') duplicate_attempts,
      (SELECT COALESCE(sum(total_eligible_value),0)::text FROM user_package_states) total_eligible,
      (SELECT COALESCE(sum(total_earning_cap),0)::text FROM user_package_states) total_cap,
      (SELECT COALESCE(sum(total_earned),0)::text FROM user_package_states) total_earned,
      (SELECT COALESCE(sum(remaining_cap),0)::text FROM user_package_states) total_remaining,
      (SELECT COALESCE(sum(excess_amount),0)::text FROM capped_excess_ledger) total_excess
      FROM package_purchases`),
    query(`SELECT d.serial_number,d.name,count(p.id) FILTER(WHERE p.status='CONFIRMED')::int purchase_count,
      COALESCE(sum(p.amount_token_units) FILTER(WHERE p.status='CONFIRMED'),0)::text volume
      FROM package_definitions d LEFT JOIN package_purchases p ON p.package_definition_id=d.id
      GROUP BY d.id ORDER BY d.serial_number`),
    query(`SELECT u.wallet_address,s.highest_package_id,s.total_earning_cap::text,s.total_earned::text,
      s.remaining_cap::text,s.capping_status FROM user_package_states s JOIN users u ON u.id=s.user_id
      WHERE $1::text IS NULL OR u.wallet_address ILIKE '%'||$1||'%' ORDER BY s.updated_at DESC LIMIT 50`,[term]),
    query(`SELECT tx_hash,wallet_address,package_id,amount_token_units::text,status,block_number
      FROM package_purchases WHERE $1::text IS NULL OR tx_hash ILIKE '%'||$1||'%'
      OR wallet_address ILIKE '%'||$1||'%' ORDER BY created_at DESC LIMIT 50`,[term]),
  ]);
  return { totals: totals.rows[0], byPackage: byPackage.rows, users: users.rows, transactions: transactions.rows };
}
