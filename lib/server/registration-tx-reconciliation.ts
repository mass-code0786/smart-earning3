import { Interface } from "ethers";
import { z } from "zod";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { normalizeWallet } from "./auth";
import { CHAIN_ID, getServerConfig } from "./config";
import { ApiError } from "./http";
import { verifyAndActivateRegistration } from "./registration-service";
import { query } from "./db";

const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const iface = new Interface(SMART_EARNING_ABI);
const REGISTRATION_LOG_BLOCK_CHUNK = 3_000;
const REGISTRATION_LOG_MAX_RETRIES = 4;
const REGISTRATION_LOG_CHUNK_STEPS = [3_000, 1_500, 750, 375, 200, 100, 50, 25, 10, 5, 1];

type ExactTransactionProvider = {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  getTransaction(txHash: string): Promise<{
    from: string;
    to: string | null;
    data: string;
  } | null>;
  getTransactionReceipt(txHash: string): Promise<{
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
  } | null>;
  getBlockNumber(): Promise<number>;
};

type RegistrationEventProvider = {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  getBlockNumber(): Promise<number>;
  getLogs(filter: {
    address: string;
    fromBlock: number;
    toBlock: number;
    topics: Array<string | null | string[]>;
  }): Promise<ReadonlyArray<{
    address: string;
    transactionHash: string;
    blockNumber: number;
    topics: readonly string[];
    data: string;
  }>>;
  getTransactionReceipt(txHash: string): Promise<{
    status: number | null;
    to: string | null;
    logs: ReadonlyArray<{
      address: string;
      topics: readonly string[];
      data: string;
    }>;
  } | null>;
};

function isRpcRateLimit(error: unknown) {
  const candidate = error as {
    code?: number | string;
    status?: number;
    message?: string;
    error?: { code?: number | string; message?: string };
  };
  const code = candidate.code ?? candidate.error?.code;
  const message = `${candidate.message ?? ""} ${candidate.error?.message ?? ""}`.toLowerCase();
  return code === -32005
    || code === "-32005"
    || candidate.status === 429
    || message.includes("limit exceeded")
    || message.includes("rate limit")
    || message.includes("too many requests");
}

type RegistrationVerifier = (
  wallet: string,
  txHash: string,
  repairEvidence?: {
    receipt: NonNullable<Awaited<ReturnType<ExactTransactionProvider["getTransactionReceipt"]>>>;
    latestBlock: number;
  },
) => Promise<{ registrationId: string; status: string; duplicate: boolean }>;

export async function inspectRegistrationProjection(
  wallet: string,
  sponsor: string,
  txHash: string,
  matrixParent: string,
  matrixIndex: bigint,
  matrixPosition: number,
) {
  const result = await query<{
    user_exists: boolean; registration_exists: boolean; relation_exists: boolean;
    relation_count: number; history_exists: boolean; history_count: number;
    sponsor_direct_count: number | null; placement_count: number;
    matrix_parent_indexed: boolean; expected_placement_exists: boolean;
    direct_income_count: number; magic_credit_count: number;
  }>(
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE') user_exists,
       EXISTS(SELECT 1 FROM registrations WHERE lower(tx_hash)=lower($3) AND status='CONFIRMED') registration_exists,
       EXISTS(
         SELECT 1 FROM referral_relations rr
         JOIN users child ON child.id=rr.user_id
         JOIN users parent ON parent.id=rr.sponsor_user_id
         WHERE lower(child.wallet_address)=lower($1) AND lower(parent.wallet_address)=lower($2)
       ) relation_exists,
       (SELECT count(*)::int
        FROM referral_relations rr
        JOIN users child ON child.id=rr.user_id
        JOIN users parent ON parent.id=rr.sponsor_user_id
        WHERE lower(child.wallet_address)=lower($1) AND lower(parent.wallet_address)=lower($2)
       ) relation_count,
       EXISTS(
         SELECT 1 FROM activity_history h
         WHERE h.event_type='DIRECT_REFERRAL_ACTIVATED'
           AND lower(h.user_wallet)=lower($2) AND lower(h.source_wallet)=lower($1)
           AND lower(h.tx_hash)=lower($3)
       ) history_exists,
       (SELECT count(*)::int FROM activity_history h
        WHERE h.event_type='DIRECT_REFERRAL_ACTIVATED'
          AND lower(h.user_wallet)=lower($2) AND lower(h.source_wallet)=lower($1)
          AND lower(h.tx_hash)=lower($3)
       ) history_count,
       (SELECT direct_count::int FROM users WHERE lower(wallet_address)=lower($2) LIMIT 1)
         sponsor_direct_count,
       (SELECT count(*)::int FROM matrix_placements mp JOIN users u ON u.id=mp.user_id
        WHERE lower(u.wallet_address)=lower($1)) placement_count,
       EXISTS(
         SELECT 1 FROM users WHERE lower(wallet_address)=lower($5)
       ) matrix_parent_indexed,
       EXISTS(
         SELECT 1 FROM matrix_placements mp
         JOIN users child ON child.id=mp.user_id
         JOIN users parent ON parent.id=mp.parent_user_id
         WHERE lower(child.wallet_address)=lower($1)
           AND lower(parent.wallet_address)=lower($5)
           AND mp.bfs_index=$6 AND mp.position=$7
       ) expected_placement_exists,
       (SELECT count(*)::int FROM direct_income_ledger d JOIN users u ON u.id=d.source_user_id
        WHERE lower(u.wallet_address)=lower($1) AND lower(d.tx_hash)=lower($3)) direct_income_count,
       (SELECT count(*)::int FROM magic_wallet_ledger m JOIN users u ON u.id=m.user_id
        WHERE lower(u.wallet_address)=lower($1) AND m.idempotency_key=$4) magic_credit_count`,
    [
      wallet, sponsor, txHash, `registration:${txHash.toLowerCase()}:magic`,
      matrixParent, matrixIndex.toString(), matrixPosition,
    ],
  );
  const state = result.rows[0];
  return {
    ...state,
    missing: [
      !state?.user_exists && "user",
      !state?.registration_exists && "registration",
      !state?.relation_exists && "referral_relation",
      !state?.history_exists && "direct_referral_history",
      !state?.matrix_parent_indexed && "matrix_parent",
      !state?.expected_placement_exists && "matrix_placement",
    ].filter(Boolean),
  };
}

export async function findRegistrationTransactionForWallet(
  walletInput: string,
  dependencies: {
    provider?: RegistrationEventProvider;
    contractAddress?: string;
    deploymentBlock: number;
    blockChunkSize?: number;
    maxRateLimitRetries?: number;
    retryDelayMs?: number;
  },
) {
  const wallet = normalizeWallet(walletInput);
  const contractAddress = normalizeWallet(
    dependencies.contractAddress ?? getServerConfig().SMART_EARNING_CONTRACT_ADDRESS,
  );
  if (!Number.isSafeInteger(dependencies.deploymentBlock) || dependencies.deploymentBlock < 0) {
    throw new ApiError(503, "Registration deployment block is invalid", "DEPLOYMENT_BLOCK_INVALID");
  }

  const provider = dependencies.provider ?? getProvider();
  const [network, latestBlock] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);
  if (Number(network.chainId) !== CHAIN_ID || CHAIN_ID !== 97) {
    throw new ApiError(503, "RPC is not connected to BNB Testnet", "WRONG_RPC_NETWORK");
  }

  const event = iface.getEvent("UserRegistered");
  if (!event) {
    throw new ApiError(500, "UserRegistered event is not configured", "EVENT_NOT_CONFIGURED");
  }
  const topics = iface.encodeFilterTopics(event, [wallet]);
  let blockChunkSize = dependencies.blockChunkSize ?? REGISTRATION_LOG_BLOCK_CHUNK;
  const maxRetries = dependencies.maxRateLimitRetries ?? REGISTRATION_LOG_MAX_RETRIES;
  const retryDelayMs = dependencies.retryDelayMs ?? 250;
  if (!Number.isSafeInteger(blockChunkSize) || blockChunkSize < 1 || blockChunkSize > 5_000) {
    throw new ApiError(503, "Registration event block chunk is invalid", "BLOCK_CHUNK_INVALID");
  }

  const candidates = [];
  let fromBlock = dependencies.deploymentBlock;
  let rateLimitAttempt = 0;
  let oneBlockRetryAttempt = 0;
  while (fromBlock <= latestBlock) {
    const toBlock = Math.min(fromBlock + blockChunkSize - 1, latestBlock);
    let logs: Awaited<ReturnType<RegistrationEventProvider["getLogs"]>>;
    try {
      logs = await provider.getLogs({
        address: contractAddress,
        fromBlock,
        toBlock,
        topics,
      });
      rateLimitAttempt = 0;
      oneBlockRetryAttempt = 0;
    } catch (error) {
      if (!isRpcRateLimit(error)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs * (2 ** Math.min(rateLimitAttempt, 5))));
      rateLimitAttempt += 1;
      const currentStep = REGISTRATION_LOG_CHUNK_STEPS.findIndex(
        (size) => size <= blockChunkSize,
      );
      const nextSize = REGISTRATION_LOG_CHUNK_STEPS[currentStep + 1];
      if (nextSize !== undefined) {
        blockChunkSize = nextSize;
        continue;
      }
      if (oneBlockRetryAttempt >= maxRetries) throw error;
      oneBlockRetryAttempt += 1;
      continue;
    }

    for (const log of logs) {
      if (normalizeWallet(log.address) !== contractAddress) continue;
      let parsed;
      try {
        parsed = iface.parseLog({ topics: log.topics, data: log.data });
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.name !== "UserRegistered") continue;
      const registrant = normalizeWallet(String(parsed.args.user));
      if (registrant !== wallet) continue;
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      if (
        !receipt
        || receipt.status !== 1
        || normalizeWallet(receipt.to || "") !== contractAddress
      ) continue;
      candidates.push({
        txHash: txHashSchema.parse(log.transactionHash).toLowerCase(),
        blockNumber: log.blockNumber,
        wallet: registrant,
        sponsor: normalizeWallet(String(parsed.args.sponsor)),
        matrixParent: normalizeWallet(String(parsed.args.matrixParent)),
        matrixIndex: BigInt(parsed.args.matrixIndex).toString(),
        matrixPosition: Number(parsed.args.matrixPosition),
        contractAddress,
      });
      if (candidates.length > 1) {
        throw new ApiError(
          409,
          "Found multiple confirmed UserRegistered events; refusing to guess",
          "MULTIPLE_REGISTRATION_EVENTS",
        );
      }
    }
    fromBlock = toBlock + 1;
  }

  if (candidates.length === 0) {
    throw new ApiError(
      404,
      "No confirmed UserRegistered event was found for this wallet",
      "REGISTRATION_EVENT_NOT_FOUND",
    );
  }
  return candidates[0];
}

export async function reconcileRegistrationTransaction(
  txHashInput: string,
  dependencies: {
    provider?: ExactTransactionProvider;
    verifyRegistration?: RegistrationVerifier;
    contractAddress?: string;
    dryRun?: boolean;
    inspectProjection?: typeof inspectRegistrationProjection;
  } = {},
) {
  const txHash = txHashSchema.parse(txHashInput).toLowerCase();
  const provider = dependencies.provider ?? getProvider();
  const contractAddress = normalizeWallet(
    dependencies.contractAddress ?? getServerConfig().SMART_EARNING_CONTRACT_ADDRESS,
  );
  const [network, transaction, receipt] = await Promise.all([
    provider.getNetwork(),
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);

  if (Number(network.chainId) !== CHAIN_ID || CHAIN_ID !== 97) {
    throw new ApiError(503, "RPC is not connected to BNB Testnet", "WRONG_RPC_NETWORK");
  }
  if (!transaction || !receipt) {
    throw new ApiError(404, "Registration transaction was not found", "TX_NOT_FOUND");
  }
  if (receipt.status !== 1) {
    throw new ApiError(422, "Registration transaction failed", "TX_REVERTED");
  }
  if (
    normalizeWallet(transaction.to || "") !== contractAddress
    || normalizeWallet(receipt.to || "") !== contractAddress
  ) {
    throw new ApiError(422, "Transaction targets another contract", "WRONG_CONTRACT");
  }

  let decoded;
  try {
    decoded = iface.parseTransaction({ data: transaction.data });
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.name !== "register") {
    throw new ApiError(422, "Transaction is not a registration", "WRONG_METHOD");
  }
  const intendedWallet = normalizeWallet(transaction.from);
  const intendedSponsor = normalizeWallet(String(decoded.args.sponsor));

  const registrationEvent = receipt.logs
    .filter((log) => normalizeWallet(log.address) === contractAddress)
    .map((log) => {
      try {
        return iface.parseLog({ topics: log.topics, data: log.data });
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "UserRegistered");
  if (!registrationEvent) {
    throw new ApiError(422, "UserRegistered event was not found", "EVENT_NOT_FOUND");
  }

  const eventWallet = normalizeWallet(String(registrationEvent.args.user));
  const eventSponsor = normalizeWallet(String(registrationEvent.args.sponsor));
  const eventMatrixParent = normalizeWallet(String(registrationEvent.args.matrixParent));
  const eventMatrixIndex = BigInt(registrationEvent.args.matrixIndex);
  const eventMatrixPosition = Number(registrationEvent.args.matrixPosition);
  if (eventWallet !== intendedWallet) {
    throw new ApiError(403, "Registration event belongs to another wallet", "WALLET_MISMATCH");
  }
  if (eventSponsor !== intendedSponsor) {
    throw new ApiError(422, "Registration sponsor does not match transaction", "SPONSOR_MISMATCH");
  }

  if (dependencies.dryRun) {
    const projection = await (dependencies.inspectProjection ?? inspectRegistrationProjection)(
      intendedWallet, eventSponsor, txHash,
      eventMatrixParent, eventMatrixIndex, eventMatrixPosition,
    );
    return {
      txHash,
      wallet: intendedWallet,
      sponsor: eventSponsor,
      matrixParent: eventMatrixParent,
      matrixIndex: eventMatrixIndex.toString(),
      matrixPosition: eventMatrixPosition,
      dryRun: true as const,
      projection,
    };
  }

  const latestBlock = await provider.getBlockNumber();
  const result = await (dependencies.verifyRegistration ?? verifyAndActivateRegistration)(
    intendedWallet,
    txHash,
    { receipt, latestBlock },
  );
  return {
    txHash,
    wallet: intendedWallet,
    sponsor: eventSponsor,
    matrixParent: eventMatrixParent,
    matrixIndex: eventMatrixIndex.toString(),
    matrixPosition: eventMatrixPosition,
    registrationId: result.registrationId,
    status: result.status,
    alreadyReconciled: result.duplicate,
  };
}
