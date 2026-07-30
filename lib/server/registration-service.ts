import { Interface, TransactionReceipt } from "ethers";
import { z } from "zod";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { CHAIN_ID, getServerConfig } from "./config";
import { transaction } from "./db";
import { ApiError } from "./http";
import { normalizeWallet } from "./auth";
import { creditGrossEarning } from "./earning-split-service";
import { internalHistoryKey, recordReferralHistory } from "./history-service";
import type { PoolClient } from "pg";

const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const iface = new Interface(SMART_EARNING_ABI);

function registrationEvent(receipt: TransactionReceipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "UserRegistered") return { log, parsed };
    } catch {
      // Logs from USDT and other contracts are intentionally ignored.
    }
  }
  throw new ApiError(422, "Registration event was not found", "EVENT_NOT_FOUND");
}

export async function reconcileExistingRegistrationProjection(
  client: PoolClient,
  input: {
    registrationId: string;
    status: string;
    userId: string;
    sponsorUserId: string;
    wallet: string;
    sponsor: string;
    txHash: string;
    blockNumber: number;
    confirmedAt: Date;
    blockHash?: string | null;
    logIndex?: number;
    confirmations?: number;
    contractAddress?: string;
  },
) {
  await client.query(
    `UPDATE users SET status='ACTIVE',activated_at=COALESCE(activated_at,$2)
     WHERE id=$1 AND (status<>'ACTIVE' OR activated_at IS NULL)`,
    [input.userId, input.confirmedAt],
  );
  await client.query(
    `UPDATE registrations SET status='CONFIRMED',block_number=COALESCE(block_number,$2),
       confirmed_at=COALESCE(confirmed_at,$3),failure_reason=NULL
     WHERE id=$1 AND (status<>'CONFIRMED' OR block_number IS NULL OR confirmed_at IS NULL)`,
    [input.registrationId, input.blockNumber, input.confirmedAt],
  );
  const relationInsert = await client.query<{ id: string }>(
    `INSERT INTO referral_relations(user_id,sponsor_user_id,registration_id)
     VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING RETURNING id`,
    [input.userId, input.sponsorUserId, input.registrationId],
  );
  const relation = (await client.query<{
    id: string; sponsor_user_id: string; registration_id: string;
  }>(
    "SELECT id,sponsor_user_id,registration_id FROM referral_relations WHERE user_id=$1",
    [input.userId],
  )).rows[0];
  if (!relation ||
      relation.sponsor_user_id !== input.sponsorUserId ||
      relation.registration_id !== input.registrationId) {
    throw new ApiError(409, "Existing referral relation conflicts with the confirmed event", "REFERRAL_CONFLICT");
  }

  await client.query(
    `UPDATE users sponsor SET direct_count=(
       SELECT count(*)::int FROM referral_relations rr WHERE rr.sponsor_user_id=sponsor.id
     ) WHERE sponsor.id=$1`,
    [input.sponsorUserId],
  );
  const history = await recordReferralHistory(client, {
    userWallet: input.sponsor,
    userId: input.sponsorUserId,
    category: "DIRECT_REFERRAL",
    eventType: "DIRECT_REFERRAL_ACTIVATED",
    title: "Direct referral activated",
    direction: "INFO",
    sourceWallet: input.wallet,
    sourceUserId: input.userId,
    sponsorWallet: input.sponsor,
    referralLevel: 1,
    status: "ACTIVE",
    txHash: input.txHash,
    blockNumber: input.blockNumber,
    sourceTable: "referral_relations",
    sourceRecordId: relation.id,
    idempotencyKey: internalHistoryKey(
      "referral_relations", relation.id, "DIRECT_REFERRAL_ACTIVATED", input.sponsor,
    ),
    occurredAt: input.confirmedAt,
  });
  if (input.logIndex !== undefined && input.contractAddress) {
    await client.query(
      `INSERT INTO blockchain_transactions(
         chain_id,tx_hash,block_number,block_hash,from_address,to_address,event_name,
         log_index,status,confirmations,raw_payload,confirmed_at
       ) VALUES($1,$2,$3,$4,$5,$6,'UserRegistered',$7,'CONFIRMED',$8,$9,$10)
       ON CONFLICT(chain_id,tx_hash,log_index) DO NOTHING`,
      [
        CHAIN_ID, input.txHash, input.blockNumber, input.blockHash || null, input.wallet,
        normalizeWallet(input.contractAddress), input.logIndex, input.confirmations || 0,
        JSON.stringify({ sponsor: input.sponsor, projectionRepair: true }), input.confirmedAt,
      ],
    );
  }
  return {
    relationCreated: Boolean(relationInsert.rows[0]),
    historyCreated: !history.duplicate,
  };
}

export async function verifyAndActivateRegistration(
  walletInput: string,
  txHashInput: string,
) {
  const wallet = normalizeWallet(walletInput);
  const txHash = hashSchema.parse(txHashInput).toLowerCase();
  const config = getServerConfig();
  const provider = getProvider();
  const [receipt, network, latestBlock] = await Promise.all([
    provider.getTransactionReceipt(txHash),
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);

  if (Number(network.chainId) !== CHAIN_ID) {
    throw new ApiError(503, "RPC is not connected to BNB Testnet", "WRONG_RPC_NETWORK");
  }
  if (!receipt) throw new ApiError(409, "Transaction is not mined yet", "TX_PENDING");
  if (receipt.status !== 1) throw new ApiError(422, "Transaction reverted", "TX_REVERTED");
  if (normalizeWallet(receipt.to || "") !== normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS)) {
    throw new ApiError(422, "Transaction targets another contract", "WRONG_CONTRACT");
  }
  const confirmations = latestBlock - receipt.blockNumber + 1;
  if (confirmations < config.CONFIRMATIONS_REQUIRED) {
    throw new ApiError(
      409,
      `Waiting for ${config.CONFIRMATIONS_REQUIRED - confirmations} confirmation(s)`,
      "CONFIRMATIONS_PENDING",
    );
  }

  const { log, parsed } = registrationEvent(receipt);
  const eventUser = normalizeWallet(String(parsed.args.user));
  const sponsor = normalizeWallet(String(parsed.args.sponsor));
  const matrixParent = normalizeWallet(String(parsed.args.matrixParent));
  const matrixIndex = BigInt(parsed.args.matrixIndex);
  const matrixPosition = Number(parsed.args.matrixPosition);
  const directIncome = BigInt(parsed.args.directSponsorIncome);
  const magicCredit = BigInt(parsed.args.magicWalletCredit);
  if (eventUser !== wallet) {
    throw new ApiError(403, "Transaction belongs to another wallet", "WALLET_MISMATCH");
  }

  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`registration:${txHash}`]);

    const existing = await client.query<{
      id: string; status: string; user_id: string; sponsor_user_id: string;
      user_wallet: string; sponsor_wallet: string; block_number: number;
      confirmed_at: Date;
    }>(
      `SELECT r.id,r.status,r.user_id,r.sponsor_user_id,
              u.wallet_address user_wallet,s.wallet_address sponsor_wallet,
              r.block_number,r.confirmed_at
       FROM registrations r JOIN users u ON u.id=r.user_id
       JOIN users s ON s.id=r.sponsor_user_id WHERE lower(r.tx_hash)=lower($1)`,
      [txHash],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (normalizeWallet(row.user_wallet) !== wallet || normalizeWallet(row.sponsor_wallet) !== sponsor) {
        throw new ApiError(409, "Indexed registration conflicts with the confirmed event", "REGISTRATION_CONFLICT");
      }
      const projection = await reconcileExistingRegistrationProjection(client, {
        registrationId: row.id,
        status: row.status,
        userId: row.user_id,
        sponsorUserId: row.sponsor_user_id,
        wallet,
        sponsor,
        txHash,
        blockNumber: row.block_number,
        confirmedAt: row.confirmed_at,
        blockHash: receipt.blockHash,
        logIndex: log.index,
        confirmations,
        contractAddress: config.SMART_EARNING_CONTRACT_ADDRESS,
      });
      return {
        registrationId: row.id,
        status: row.status,
        duplicate: true,
        repaired: projection.relationCreated || projection.historyCreated,
      };
    }
    const existingUser = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(wallet_address)=lower($1) FOR UPDATE",
      [wallet],
    );
    let reusableUserId: string | undefined;
    if (existingUser.rows[0]) {
      const footprint = await client.query<{ has_projection: boolean }>(
        `SELECT(
          EXISTS(SELECT 1 FROM registrations WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM referral_relations WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM matrix_placements WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM magic_wallet_ledger WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM income_wallet_ledger WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM earning_split_events WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM x3_hold_ledger WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM package_purchases WHERE user_id=$1)
        ) has_projection`,
        [existingUser.rows[0].id],
      );
      if (footprint.rows[0]?.has_projection) {
        throw new ApiError(409, "Wallet has conflicting ownership projections", "OWNERSHIP_CONFLICT");
      }
      reusableUserId = existingUser.rows[0].id;
    }
    const sponsorResult = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE wallet_address=$1 AND status='ACTIVE' FOR UPDATE",
      [sponsor],
    );
    if (!sponsorResult.rows[0]) {
      throw new ApiError(422, "Sponsor is not active in the index", "SPONSOR_NOT_INDEXED");
    }
    const parentResult = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE wallet_address=$1",
      [matrixParent],
    );
    if (!parentResult.rows[0]) {
      throw new ApiError(422, "Matrix parent is not indexed", "MATRIX_PARENT_NOT_INDEXED");
    }

    const userId = reusableUserId || (await client.query<{ id: string }>(
      `INSERT INTO users(wallet_address,status,activated_at)
       VALUES($1,'ACTIVE',now()) RETURNING id`,
      [wallet],
    )).rows[0].id;
    if (reusableUserId) {
      await client.query(
        "UPDATE users SET status='ACTIVE',activated_at=COALESCE(activated_at,now()) WHERE id=$1",
        [reusableUserId],
      );
    }
    const registrationResult = await client.query<{ id: string }>(
      `INSERT INTO registrations(
         user_id,sponsor_user_id,tx_hash,chain_id,amount_token_units,status,block_number,confirmed_at
       ) VALUES($1,$2,$3,$4,$5,'CONFIRMED',$6,now()) RETURNING id`,
      [userId, sponsorResult.rows[0].id, txHash, CHAIN_ID, magicCredit * 2n, receipt.blockNumber],
    );
    const registrationId = registrationResult.rows[0].id;
    const registrationValue = magicCredit * 2n;

    await client.query(
      `INSERT INTO user_package_states(
        user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap
       ) VALUES($1,$2,$2,$3,0,$3)`,
      [userId, registrationValue.toString(), (registrationValue * 5n).toString()],
    );
    await client.query(
      `INSERT INTO earning_cap_ledger(
        user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
       ) VALUES($1,'REGISTRATION',$2,$3,$4,$4)`,
      [userId, registrationId, registrationValue.toString(), (registrationValue * 5n).toString()],
    );

    await client.query(
      `INSERT INTO referral_relations(user_id,sponsor_user_id,registration_id)
       VALUES($1,$2,$3)`,
      [userId, sponsorResult.rows[0].id, registrationId],
    );
    await client.query(
      `INSERT INTO matrix_placements(
        user_id,parent_user_id,position,bfs_index,registration_id
       ) VALUES($1,$2,$3,$4,$5)`,
      [userId,parentResult.rows[0].id,matrixPosition,matrixIndex.toString(),registrationId],
    );
    await client.query(
      `UPDATE users sponsor SET direct_count=(
         SELECT count(*)::int FROM referral_relations rr WHERE rr.sponsor_user_id=sponsor.id
       ) WHERE sponsor.id=$1`,
      [sponsorResult.rows[0].id],
    );
    await client.query(
      `INSERT INTO magic_wallet_ledger(
        user_id,registration_id,direction,amount_token_units,reason,idempotency_key,metadata
       ) VALUES($1,$2,'CREDIT',$3,'REGISTRATION_CREDIT',$4,$5)`,
      [userId, registrationId, magicCredit.toString(), `registration:${txHash}:magic`, JSON.stringify({ txHash })],
    );
    const cappedDirect = await creditGrossEarning({
      userId: sponsorResult.rows[0].id,
      incomeType: "DIRECT_INCOME",
      sourceReference: registrationId,
      grossAmount: magicCredit,
      idempotencyKey: `registration:${txHash}:direct-cap`,
      magicAlreadyOnchain:true,
    }, client);
    if (cappedDirect.credited !== directIncome) {
      throw new ApiError(409, "On-chain and indexed earning cap disagree", "CAP_RECONCILIATION_FAILED");
    }
    if (directIncome > 0n) {
      await client.query(
        `INSERT INTO direct_income_ledger(
          sponsor_user_id,source_user_id,registration_id,amount_token_units,tx_hash,idempotency_key
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [sponsorResult.rows[0].id, userId, registrationId, directIncome.toString(), txHash, `registration:${txHash}:direct`],
      );
    }
    await client.query(
      `INSERT INTO blockchain_transactions(
        chain_id,tx_hash,block_number,block_hash,from_address,to_address,event_name,log_index,status,confirmations,raw_payload,confirmed_at
       ) VALUES($1,$2,$3,$4,$5,$6,'UserRegistered',$7,'CONFIRMED',$8,$9,now())`,
      [
        CHAIN_ID,
        txHash,
        receipt.blockNumber,
        receipt.blockHash,
        wallet,
        normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS),
        log.index,
        confirmations,
        JSON.stringify({
          sponsor,
          matrixParent,
          matrixIndex: matrixIndex.toString(),
          matrixPosition,
        }),
      ],
    );

    return { registrationId, status: "CONFIRMED", duplicate: false };
  });
}
