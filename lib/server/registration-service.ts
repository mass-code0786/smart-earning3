import { Contract, Interface } from "ethers";
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

type BlockchainDiagnostic = {
  functionName: string;
  contractAddress: string;
  txHash: string;
  calldata?: string;
};

type PostgreSqlDiagnostic = {
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  detail?: string;
  routine?: string;
  message?: string;
};

export function safePostgreSqlDiagnostic(error: unknown): PostgreSqlDiagnostic {
  const candidate = error as PostgreSqlDiagnostic;
  return {
    code: candidate?.code,
    constraint: candidate?.constraint,
    table: candidate?.table,
    column: candidate?.column,
    schema: candidate?.schema,
    detail: candidate?.detail,
    routine: candidate?.routine,
    message: candidate?.message?.slice(0, 500),
  };
}

function databaseOperationName(sql: unknown) {
  if (typeof sql !== "string") return "prepared-query";
  const normalized = sql.replace(/\s+/g, " ").trim();
  const tableOperation = normalized.match(/^(INSERT INTO|UPDATE|DELETE FROM) ([a-z_]+)/i);
  if (tableOperation) return `${tableOperation[1].toUpperCase()}:${tableOperation[2].toLowerCase()}`;
  if (/^SELECT pg_advisory_xact_lock/i.test(normalized)) return "LOCK:registration";
  const selectTable = normalized.match(/^SELECT .*? FROM ([a-z_]+)/i);
  if (selectTable) return `SELECT:${selectTable[1].toLowerCase()}`;
  return normalized.split(" ", 1)[0]?.toUpperCase() || "QUERY";
}

export function diagnosticRegistrationClient(client: PoolClient, txHash: string): PoolClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        const operation = databaseOperationName(args[0]);
        try {
          const result = await Reflect.apply(target.query, target, args);
          console.info("[registration:postgres-operation]", { operation, txHash, success: true });
          return result;
        } catch (error) {
          console.error("[registration:postgres-operation]", {
            operation, txHash, success: false, ...safePostgreSqlDiagnostic(error),
          });
          throw error;
        }
      };
    },
  });
}

async function diagnosticBlockchainCall<T>(
  diagnostic: BlockchainDiagnostic,
  operation: () => Promise<T>,
) {
  try {
    const result = await operation();
    console.info("[registration:blockchain-call]", { ...diagnostic, success: true });
    return result;
  } catch (error) {
    const ethersError = error as {
      code?: string; reason?: string | null; data?: string | null;
      shortMessage?: string; action?: string;
      info?: { error?: { code?: number | string; message?: string; data?: string } };
    };
    console.error("[registration:blockchain-call]", {
      ...diagnostic,
      success: false,
      ethersCode: ethersError.code,
      action: ethersError.action,
      reason: ethersError.reason,
      revertData: ethersError.data ?? ethersError.info?.error?.data,
      rpcCode: ethersError.info?.error?.code,
      message: ethersError.shortMessage ?? ethersError.info?.error?.message,
    });
    throw error;
  }
}

async function ensureConfirmedMatrixParent(
  client: PoolClient,
  wallet: string,
  confirmedAt: Date,
) {
  const parent = await client.query<{ id: string }>(
    `INSERT INTO users(wallet_address,status,activated_at)
     VALUES($1,'ACTIVE',$2)
     ON CONFLICT(wallet_address) DO UPDATE SET
       status='ACTIVE',activated_at=COALESCE(users.activated_at,EXCLUDED.activated_at)
     RETURNING id`,
    [wallet, confirmedAt],
  );
  return parent.rows[0].id;
}

async function ensureConfirmedSponsor(
  client: PoolClient,
  wallet: string,
  confirmedAt: Date,
  registrationValue: bigint,
  currentEarningCap: bigint,
) {
  const userId = await ensureConfirmedMatrixParent(client, wallet, confirmedAt);
  await client.query(
    `INSERT INTO user_package_states(
       user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap
     ) VALUES($1,$2,$2,$3,0,$3) ON CONFLICT(user_id) DO NOTHING`,
    [userId, registrationValue.toString(), currentEarningCap.toString()],
  );
  return userId;
}

type ConfirmedRegistrationReceipt = {
  status: number | null;
  to: string | null;
  blockNumber: number;
  blockHash: string;
  logs: ReadonlyArray<{
    address: string;
    index: number;
    topics: readonly string[];
    data: string;
  }>;
};

function registrationEvent(receipt: ConfirmedRegistrationReceipt, contractAddress: string) {
  for (const log of receipt.logs) {
    if (normalizeWallet(log.address) !== normalizeWallet(contractAddress)) continue;
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
    matrixParent?: string;
    matrixIndex?: bigint;
    matrixPosition?: number;
    registrationValue?: bigint;
    directIncome?: bigint;
    directGross?: bigint;
    magicCredit?: bigint;
  },
) {
  await client.query(
    `UPDATE users SET status='ACTIVE',activated_at=COALESCE(activated_at,$2)
     WHERE id=$1 AND (status<>'ACTIVE' OR activated_at IS NULL)`,
    [input.userId, input.confirmedAt],
  );
  let financialCreated = false;
  if (
    input.registrationValue !== undefined
    && input.directIncome !== undefined
    && input.directGross !== undefined
    && input.magicCredit !== undefined
  ) {
    await client.query(
      `INSERT INTO user_package_states(
         user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap
       ) VALUES($1,$2,$2,$3,0,$3) ON CONFLICT(user_id) DO NOTHING`,
      [
        input.userId, input.registrationValue.toString(),
        (input.registrationValue * 5n).toString(),
      ],
    );
    await client.query(
      `INSERT INTO earning_cap_ledger(
         user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
       ) VALUES($1,'REGISTRATION',$2,$3,$4,$4)
       ON CONFLICT(source_type,source_reference) DO NOTHING`,
      [
        input.userId, input.registrationId, input.registrationValue.toString(),
        (input.registrationValue * 5n).toString(),
      ],
    );
    const magic = await client.query(
      `INSERT INTO magic_wallet_ledger(
         user_id,registration_id,direction,amount_token_units,reason,idempotency_key,metadata
       ) VALUES($1,$2,'CREDIT',$3,'REGISTRATION_CREDIT',$4,$5)
       ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [
        input.userId, input.registrationId, input.magicCredit.toString(),
        `registration:${input.txHash}:magic`, JSON.stringify({ txHash: input.txHash }),
      ],
    );
    const cappedDirect = await creditGrossEarning({
      userId: input.sponsorUserId,
      incomeType: "DIRECT_INCOME",
      sourceReference: input.registrationId,
      grossAmount: input.directGross,
      idempotencyKey: `registration:${input.txHash}:direct-cap`,
      magicAlreadyOnchain: true,
      confirmedOnchainCredit: input.directIncome,
    }, client);
    if (cappedDirect.credited !== input.directIncome) {
      throw new ApiError(409, "On-chain and indexed earning cap disagree", "CAP_RECONCILIATION_FAILED");
    }
    let directCreated = false;
    if (input.directIncome > 0n) {
      const direct = await client.query(
        `INSERT INTO direct_income_ledger(
           sponsor_user_id,source_user_id,registration_id,amount_token_units,tx_hash,idempotency_key
         ) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
        [
          input.sponsorUserId, input.userId, input.registrationId,
          input.directIncome.toString(), input.txHash,
          `registration:${input.txHash}:direct`,
        ],
      );
      directCreated = Boolean(direct.rows[0]);
    }
    financialCreated = Boolean(magic.rows[0]) || !cappedDirect.duplicate || directCreated;
  }
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

  let placementCreated = false;
  if (
    input.matrixParent !== undefined
    && input.matrixIndex !== undefined
    && input.matrixPosition !== undefined
    && input.contractAddress !== undefined
  ) {
    const parentUserId = await ensureConfirmedMatrixParent(
      client, input.matrixParent, input.confirmedAt,
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO matrix_placements(
         user_id,parent_user_id,position,registration_id,sponsor_user_id,
         transaction_hash,block_number,log_index,contract_address,contract_matrix_index
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(user_id) DO NOTHING RETURNING id`,
      [
        input.userId, parentUserId, input.matrixPosition,
        input.registrationId, input.sponsorUserId, input.txHash, input.blockNumber,
        input.logIndex, normalizeWallet(input.contractAddress), input.matrixIndex.toString(),
      ],
    );
    const placement = await client.query<{
      parent_user_id: string; position: number; contract_address: string;
      contract_matrix_index: string; registration_id: string;
    }>(
      `SELECT parent_user_id,position,contract_address,contract_matrix_index::text,registration_id
       FROM matrix_placements WHERE user_id=$1`,
      [input.userId],
    );
    const row = placement.rows[0];
    if (
      !row
      || row.parent_user_id !== parentUserId
      || row.position !== input.matrixPosition
      || normalizeWallet(row.contract_address) !== normalizeWallet(input.contractAddress)
      || row.contract_matrix_index !== input.matrixIndex.toString()
      || row.registration_id !== input.registrationId
    ) {
      throw new ApiError(
        409,
        "Existing matrix placement conflicts with the confirmed event",
        "MATRIX_PROJECTION_CONFLICT",
      );
    }
    placementCreated = Boolean(inserted.rows[0]);
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
    await client.query(
      `INSERT INTO blockchain_processed_events(
         chain_id,contract_address,transaction_hash,log_index,block_number,event_name
       ) VALUES($1,$2,$3,$4,$5,'UserRegistered')
       ON CONFLICT(chain_id,transaction_hash,log_index) DO NOTHING`,
      [
        CHAIN_ID, normalizeWallet(input.contractAddress), input.txHash,
        input.logIndex, input.blockNumber,
      ],
    );
  }
  return {
    relationCreated: Boolean(relationInsert.rows[0]),
    historyCreated: !history.duplicate,
    placementCreated,
    financialCreated,
  };
}

export async function verifyAndActivateRegistration(
  walletInput: string,
  txHashInput: string,
  repairEvidence?: {
    receipt: ConfirmedRegistrationReceipt;
    latestBlock: number;
  },
) {
  const wallet = normalizeWallet(walletInput);
  const txHash = hashSchema.parse(txHashInput).toLowerCase();
  const config = getServerConfig();
  const provider = getProvider();
  const [receipt, network, latestBlock] = repairEvidence
    ? [repairEvidence.receipt, { chainId: BigInt(CHAIN_ID) }, repairEvidence.latestBlock]
    : await Promise.all([
        diagnosticBlockchainCall({
          functionName: "eth_getTransactionReceipt",
          contractAddress: config.SMART_EARNING_CONTRACT_ADDRESS,
          txHash,
        }, () => provider.getTransactionReceipt(txHash)),
        diagnosticBlockchainCall({
          functionName: "eth_chainId",
          contractAddress: config.SMART_EARNING_CONTRACT_ADDRESS,
          txHash,
        }, () => provider.getNetwork()),
        diagnosticBlockchainCall({
          functionName: "eth_blockNumber",
          contractAddress: config.SMART_EARNING_CONTRACT_ADDRESS,
          txHash,
        }, () => provider.getBlockNumber()),
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

  const { log, parsed } = registrationEvent(receipt, config.SMART_EARNING_CONTRACT_ADDRESS);
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
  let registrationPrice: bigint;
  let sponsorEarningCap: bigint;
  if (repairEvidence) {
    registrationPrice = magicCredit * 2n;
    sponsorEarningCap = registrationPrice * 5n;
  } else {
    registrationPrice = magicCredit * 2n;
    const registrationContract = new Contract(
      config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, provider,
    );
    sponsorEarningCap = BigInt(await diagnosticBlockchainCall({
      functionName: "getTotalEarningCap(address)",
      contractAddress: config.SMART_EARNING_CONTRACT_ADDRESS,
      txHash,
      calldata: iface.encodeFunctionData("getTotalEarningCap", [sponsor]),
    }, () => registrationContract.getTotalEarningCap(sponsor)));
    if (sponsorEarningCap < directIncome) {
      throw new ApiError(409, "Sponsor on-chain cap is inconsistent with the event", "CAP_RECONCILIATION_FAILED");
    }
  }

  return transaction(async (rawClient) => {
    const client = diagnosticRegistrationClient(rawClient, txHash);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`registration:${txHash}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`registration-sponsor:${sponsor}`]);
    const sponsorUserId = await ensureConfirmedSponsor(
      client, sponsor, new Date(), registrationPrice, sponsorEarningCap,
    );

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
        matrixParent,
        matrixIndex,
        matrixPosition,
        registrationValue: magicCredit * 2n,
        directIncome,
        directGross: magicCredit,
        magicCredit,
      });
      return {
        registrationId: row.id,
        status: row.status,
        duplicate: true,
        repaired: projection.relationCreated || projection.historyCreated
          || projection.placementCreated || projection.financialCreated,
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
          OR EXISTS(SELECT 1 FROM magic_wallet_ledger WHERE user_id=$1 AND registration_id IS NOT NULL)
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
    const parentUserId = await ensureConfirmedMatrixParent(client, matrixParent, new Date());

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
      [userId, sponsorUserId, txHash, CHAIN_ID, magicCredit * 2n, receipt.blockNumber],
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
      [userId, sponsorUserId, registrationId],
    );
    await client.query(
      `INSERT INTO matrix_placements(
        user_id,parent_user_id,position,registration_id,sponsor_user_id,
        transaction_hash,block_number,log_index,contract_address,contract_matrix_index
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        userId,parentUserId,matrixPosition,registrationId,sponsorUserId,txHash,
        receipt.blockNumber,log.index,normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS),
        matrixIndex.toString(),
      ],
    );
    await client.query(
      `UPDATE users sponsor SET direct_count=(
         SELECT count(*)::int FROM referral_relations rr WHERE rr.sponsor_user_id=sponsor.id
       ) WHERE sponsor.id=$1`,
      [sponsorUserId],
    );
    await client.query(
      `INSERT INTO magic_wallet_ledger(
        user_id,registration_id,direction,amount_token_units,reason,idempotency_key,metadata
       ) VALUES($1,$2,'CREDIT',$3,'REGISTRATION_CREDIT',$4,$5)`,
      [userId, registrationId, magicCredit.toString(), `registration:${txHash}:magic`, JSON.stringify({ txHash })],
    );
    const cappedDirect = await creditGrossEarning({
      userId: sponsorUserId,
      incomeType: "DIRECT_INCOME",
      sourceReference: registrationId,
      grossAmount: magicCredit,
      idempotencyKey: `registration:${txHash}:direct-cap`,
      magicAlreadyOnchain:true,
      confirmedOnchainCredit:directIncome,
    }, client);
    if (cappedDirect.credited !== directIncome) {
      throw new ApiError(409, "On-chain and indexed earning cap disagree", "CAP_RECONCILIATION_FAILED");
    }
    if (directIncome > 0n) {
      await client.query(
        `INSERT INTO direct_income_ledger(
          sponsor_user_id,source_user_id,registration_id,amount_token_units,tx_hash,idempotency_key
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [sponsorUserId, userId, registrationId, directIncome.toString(), txHash, `registration:${txHash}:direct`],
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
    await client.query(
      `INSERT INTO blockchain_processed_events(
        chain_id,contract_address,transaction_hash,log_index,block_number,event_name
       ) VALUES($1,$2,$3,$4,$5,'UserRegistered')
       ON CONFLICT(chain_id,transaction_hash,log_index) DO NOTHING`,
      [
        CHAIN_ID, normalizeWallet(config.SMART_EARNING_CONTRACT_ADDRESS),
        txHash, log.index, receipt.blockNumber,
      ],
    );

    return { registrationId, status: "CONFIRMED", duplicate: false };
  });
}
