import { Interface, TransactionReceipt } from "ethers";
import { z } from "zod";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { CHAIN_ID, getServerConfig } from "./config";
import { transaction } from "./db";
import { ApiError } from "./http";
import { normalizeWallet } from "./auth";
import { creditGrossEarning } from "./earning-split-service";

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

    const existing = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM registrations WHERE tx_hash=$1",
      [txHash],
    );
    if (existing.rows[0]) {
      return { registrationId: existing.rows[0].id, status: existing.rows[0].status, duplicate: true };
    }
    const duplicateWallet = await client.query("SELECT 1 FROM users WHERE wallet_address=$1", [wallet]);
    if (duplicateWallet.rowCount) {
      throw new ApiError(409, "Wallet is already registered", "ALREADY_REGISTERED");
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

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users(wallet_address,status,activated_at)
       VALUES($1,'ACTIVE',now()) RETURNING id`,
      [wallet],
    );
    const userId = userResult.rows[0].id;
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
    await client.query("UPDATE users SET direct_count=direct_count+1 WHERE id=$1", [
      sponsorResult.rows[0].id,
    ]);
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
