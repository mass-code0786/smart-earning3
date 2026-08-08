import { Interface } from "ethers";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import {
  indexerRpcUrls,
  RateLimitedRpcErrorLogger,
  ReadOnlyIndexerRpc,
} from "@/lib/blockchain/indexer-rpc";
import { CHAIN_ID, getServerConfig } from "./config";
import { getPool, query } from "./db";
import { smartEarningDeployment } from "@/lib/blockchain/deployment-metadata";
import { getSmartEarningContract as getOnchainRegistrationState } from "@/lib/blockchain/provider";
import { transaction } from "./db";
import { bootstrapGenesis } from "./genesis-bootstrap";
import { verifyAndActivateRegistration } from "./registration-service";
import { verifyPackagePurchase } from "./package-service";
import { ApiError } from "./http";
import {
  configuredStartBlock,
  initializeForwardIndexer,
  processConfirmedBlocks,
  safeLatestBlock,
  type IndexerCheckpointStore,
  type IndexerLog,
  type IndexerReceipt,
  type ProcessedEventStore,
} from "@/scripts/indexer-core";

const iface = new Interface([...SMART_EARNING_ABI, ...PACKAGE_ABI]);
const projectedEvents = new Set(["UserRegistered", "PackagePurchased"]);
export const LIVE_INDEXER_MODE = "block_receipt_indexing" as const;
export const LIVE_INDEXER_SOURCE = "lib/server/blockchain-indexer.ts";
type IndexerHealth = {
  mode: typeof LIVE_INDEXER_MODE;
  running: boolean;
  chainId: number;
  contractAddress: string | null;
  lastProcessedBlock: number | null;
  safeLatestBlock: number | null;
  blocksBehind: number | null;
  lastSuccessfulScanTime: string | null;
  lastError: string | null;
  currentRpcEndpointRedacted: string | null;
  rpcFailoverCount: number;
  currentRetryDelayMs: number;
  ready: boolean;
  readinessReasons: string[];
  unresolvedRegistrationConflicts: number;
  lockOwned: boolean;
};

const health: IndexerHealth = {
  mode: LIVE_INDEXER_MODE,
  running: false,
  chainId: CHAIN_ID,
  contractAddress: null,
  lastProcessedBlock: null,
  safeLatestBlock: null,
  blocksBehind: null,
  lastSuccessfulScanTime: null,
  lastError: null,
  currentRpcEndpointRedacted: null,
  rpcFailoverCount: 0,
  currentRetryDelayMs: 0,
  ready: false,
  readinessReasons: ["not started"],
  unresolvedRegistrationConflicts: 0,
  lockOwned: false,
};
let worker: Promise<void> | undefined;
let stopped = false;
let shutdownBound = false;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let wakePoll: (() => void) | undefined;

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function blockchainIndexerConfig() {
  // SMART_EARNING_DEPLOYMENT_BLOCK is authoritative in tracked metadata.
  const deployment = smartEarningDeployment();
  const deploymentBlock = deployment.blockNumber;
  const configuredStart = configuredStartBlock();
  if (configuredStart !== undefined && configuredStart > deployment.blockNumber - 1) {
    throw new Error("BLOCKCHAIN_INDEXER_START_BLOCK cannot skip the deployment history");
  }
  return {
    confirmations: positiveInteger("BLOCKCHAIN_CONFIRMATIONS", 3),
    pollMs: positiveInteger("BLOCKCHAIN_INDEXER_POLL_MS", 5_000),
    // A checkpoint represents the last processed block. Starting one block
    // before deployment ensures the deployment block itself is inspected.
    deployment,
    startBlock: configuredStart ?? deploymentBlock - 1,
  };
}

const checkpoints: IndexerCheckpointStore = {
  async getLastBlock(chainId, contractAddress) {
    const result = await query<{ last_processed_block: string }>(
      `SELECT last_processed_block::text FROM blockchain_indexer_state
       WHERE chain_id=$1 AND contract_address=$2`,
      [chainId, contractAddress],
    );
    return result.rows[0] ? Number(result.rows[0].last_processed_block) : undefined;
  },
  async initialize(chainId, contractAddress, blockNumber) {
    const result = await query<{ last_processed_block: string }>(
      `INSERT INTO blockchain_indexer_state(
         chain_id,contract_address,last_processed_block,history_start_block
       ) VALUES($1,$2,$3,$3) ON CONFLICT(chain_id,contract_address) DO UPDATE
       SET last_processed_block=blockchain_indexer_state.last_processed_block
       RETURNING last_processed_block::text`,
      [chainId, contractAddress, blockNumber],
    );
    return Number(result.rows[0].last_processed_block);
  },
  async commitLastBlock(chainId, contractAddress, blockNumber) {
    await query(
      `UPDATE blockchain_indexer_state SET last_processed_block=$3,updated_at=now()
       WHERE chain_id=$1 AND contract_address=$2 AND last_processed_block<$3`,
      [chainId, contractAddress, blockNumber],
    );
  },
};

export async function reconcileLegacyIndexerCheckpoint(
  chainId: number,
  contractAddress: string,
  historyStartBlock: number,
  database: { query: typeof query } = { query },
) {
  const result = await database.query<{ previous_checkpoint: string; last_processed_block: string }>(
    `WITH legacy AS (
       SELECT id,last_processed_block FROM blockchain_indexer_state
       WHERE chain_id=$1 AND contract_address=$2
         AND (history_start_block IS NULL OR history_start_block>$3)
       FOR UPDATE
     ), updated AS (
       UPDATE blockchain_indexer_state state
       SET last_processed_block=LEAST(state.last_processed_block,$3),
           history_start_block=$3,
           updated_at=now()
       FROM legacy WHERE state.id=legacy.id
       RETURNING legacy.last_processed_block previous_checkpoint,state.last_processed_block
     )
     SELECT previous_checkpoint::text,last_processed_block::text FROM updated`,
    [chainId, contractAddress, historyStartBlock],
  );
  if (!result.rows[0]) return null;
  return {
    previousCheckpoint: Number(result.rows[0].previous_checkpoint),
    checkpoint: Number(result.rows[0].last_processed_block),
  };
}

const processedEvents: ProcessedEventStore = {
  async has(chainId, transactionHash, logIndex) {
    const result = await query(
      `SELECT 1 FROM blockchain_processed_events
       WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`,
      [chainId, transactionHash.toLowerCase(), logIndex],
    );
    return Boolean(result.rowCount);
  },
  async record(input) {
    await query(
      `INSERT INTO blockchain_processed_events(
         chain_id,contract_address,transaction_hash,log_index,block_number,event_name
       ) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(chain_id,transaction_hash,log_index) DO NOTHING`,
      [
        input.chainId, input.contractAddress, input.transactionHash.toLowerCase(),
        input.logIndex, input.blockNumber, input.eventName,
      ],
    );
  },
};

async function ensureGenesisProjection(genesis: string) {
  const registrationPrice = BigInt(await getOnchainRegistrationState().registrationPrice());
  await transaction((client) => bootstrapGenesis(client, genesis, registrationPrice));
}

export async function alignDirectX3Rollout(
  deploymentBlock: number,
  database: { query: typeof query } = { query },
) {
  const boundary = deploymentBlock - 1;
  const result = await database.query(
    `UPDATE x3_direct_rollout SET boundary_block_number=$1,boundary_log_index=-1,
       boundary_contract_event_id=NULL,mode='CONTRACT_ALIGNED',activated_at=now()
     WHERE singleton=true AND (mode<>'CONTRACT_ALIGNED' OR boundary_block_number<>$1
       OR boundary_log_index<>-1)`,
    [boundary],
  );
  return Boolean(result.rowCount);
}

export function decodedIndexerEventName(log: IndexerLog) {
  try {
    return iface.parseLog(log)?.name;
  } catch {
    return undefined;
  }
}

async function handleLog(log: IndexerLog, eventName: string, _receipt: IndexerReceipt) {
  const event = iface.parseLog(log);
  if (!event) return;
  if (eventName === "UserRegistered") {
    try {
      await verifyAndActivateRegistration(String(event.args.user), log.transactionHash);
    } catch (error) {
      const hardConflictCodes = new Set([
        "REGISTRATION_CONFLICT", "REFERRAL_CONFLICT", "MATRIX_PROJECTION_CONFLICT",
        "OWNERSHIP_CONFLICT", "CAP_RECONCILIATION_FAILED",
      ]);
      if (!(error instanceof ApiError) || !hardConflictCodes.has(error.code)) throw error;
      const wallet = String(event.args.user).toLowerCase();
      const actual = await query(
        `SELECT u.wallet_address,p.wallet_address parent_wallet,s.wallet_address sponsor_wallet,
                mp.position,mp.contract_matrix_index::text matrix_index,
                mp.bfs_index::text database_bfs_index,r.tx_hash
         FROM users u
         LEFT JOIN matrix_placements mp ON mp.user_id=u.id
         LEFT JOIN users p ON p.id=mp.parent_user_id
         LEFT JOIN registrations r ON r.user_id=u.id
         LEFT JOIN users s ON s.id=r.sponsor_user_id
         WHERE u.wallet_address=$1`,
        [wallet],
      );
      await query(
        `INSERT INTO registration_projection_conflicts(
           chain_id,contract_address,transaction_hash,log_index,block_number,
           conflict_type,expected,actual
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(chain_id,transaction_hash,log_index,conflict_type)
         DO UPDATE SET expected=EXCLUDED.expected,actual=EXCLUDED.actual`,
        [
          CHAIN_ID, log.address.toLowerCase(), log.transactionHash.toLowerCase(), log.index,
          log.blockNumber, error.code,
          JSON.stringify({
            wallet,
            sponsor: String(event.args.sponsor).toLowerCase(),
            matrixParent: String(event.args.matrixParent).toLowerCase(),
            matrixIndex: String(event.args.matrixIndex),
            matrixPosition: Number(event.args.matrixPosition),
          }),
          JSON.stringify({ message: error.message, rows: actual.rows }),
        ],
      );
      console.error("[blockchain-indexer] registration projection conflict", {
        code: error.code, transactionHash: log.transactionHash, logIndex: log.index,
      });
    }
  } else if (eventName === "PackagePurchased") {
    await verifyPackagePurchase(String(event.args.user), log.transactionHash);
  } else if (!projectedEvents.has(eventName)) {
    const payload = Object.fromEntries(event.fragment.inputs.map((input, index) => {
      const value = event.args[index];
      return [input.name || String(index), typeof value === "bigint" ? value.toString() : value];
    }));
    await query(
      `INSERT INTO contract_events(
         chain_id,contract_address,tx_hash,log_index,block_number,block_hash,event_name,payload
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(chain_id,tx_hash,log_index) DO NOTHING`,
      [
        CHAIN_ID, log.address.toLowerCase(), log.transactionHash.toLowerCase(), log.index,
        log.blockNumber, _receipt.blockHash || `0x${"0".repeat(64)}`, eventName,
        JSON.stringify(payload),
      ],
    );
  }
}

const sleepUntilPoll = (milliseconds: number) => new Promise<void>((resolve) => {
  wakePoll = resolve;
  wakeTimer = setTimeout(() => {
    wakeTimer = undefined;
    wakePoll = undefined;
    resolve();
  }, milliseconds);
});

async function run() {
  const server = getServerConfig();
  const config = blockchainIndexerConfig();
  if (CHAIN_ID !== config.deployment.chainId) throw new Error("Configured chain ID conflicts with deployment metadata");
  if (server.SMART_EARNING_CONTRACT_ADDRESS.toLowerCase() !== config.deployment.address) {
    throw new Error("Configured contract address conflicts with deployment metadata");
  }
  const lockClient = await getPool().connect();
  const lock = await lockClient.query<{ owned: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1),$2) owned",
    ["smart-earning-registration-indexer", CHAIN_ID],
  );
  if (!lock.rows[0]?.owned) {
    lockClient.release();
    throw new Error("Registration indexer ownership lock is already held by another process");
  }
  health.lockOwned = true;
  try {
  let activeBlock: number | null = null;
  const errorLogger = new RateLimitedRpcErrorLogger();
  const provider = new ReadOnlyIndexerRpc(indexerRpcUrls(), {
    onRetry(details) {
      health.currentRpcEndpointRedacted = provider.currentEndpointRedacted;
      health.rpcFailoverCount = provider.rpcFailoverCount;
      health.currentRetryDelayMs = details.nextRetryDelayMs;
      errorLogger.log({ blockNumber: activeBlock, ...details });
    },
    onSuccess(method) {
      health.currentRetryDelayMs = 0;
      errorLogger.clear(method);
    },
  });
  const contractAddress = server.SMART_EARNING_CONTRACT_ADDRESS.toLowerCase();
  await ensureGenesisProjection(config.deployment.genesis);
  await alignDirectX3Rollout(config.deployment.blockNumber);
  const reconciledCheckpoint = await reconcileLegacyIndexerCheckpoint(
    CHAIN_ID, contractAddress, config.startBlock,
  );
  if (reconciledCheckpoint) {
    console.info("[blockchain-indexer] reconciled legacy checkpoint", {
      ...reconciledCheckpoint,
      historyStartBlock: config.startBlock,
    });
  }
  health.contractAddress = contractAddress;
  health.currentRpcEndpointRedacted = provider.currentEndpointRedacted;
  health.running = true;
  const initialized = await initializeForwardIndexer({
    chainId: CHAIN_ID, contractAddress, confirmations: config.confirmations,
    provider, checkpoints, startBlock: config.startBlock,
  });
  health.lastProcessedBlock = initialized.checkpoint;
  health.safeLatestBlock = initialized.safeLatest;
  health.blocksBehind = Math.max(0, initialized.safeLatest - initialized.checkpoint);
  console.info("[blockchain-indexer] ready", {
    chainId: CHAIN_ID,
    contractAddress,
    deploymentBlock: config.deployment.blockNumber,
    checkpoint: initialized.checkpoint,
    safeLatest: initialized.safeLatest,
    initialized: initialized.initialized,
    lockOwned: true,
  });

  while (!stopped) {
    try {
      const priorCheckpoint = await checkpoints.getLastBlock(CHAIN_ID, contractAddress);
      activeBlock = priorCheckpoint === undefined ? null : priorCheckpoint + 1;
      const result = await processConfirmedBlocks({
        chainId: CHAIN_ID, contractAddress, confirmations: config.confirmations,
        provider, checkpoints, processedEvents,
        eventName: decodedIndexerEventName, handleLog,
        onBlock: ({ blockNumber, matchingTransactions, eventCount }) => {
          activeBlock = blockNumber + 1;
          console.info(
            `[blockchain-indexer] processed block=${blockNumber}` +
            ` contract_txs=${matchingTransactions} events=${eventCount}`,
          );
        },
      });
      health.lastProcessedBlock = result.checkpoint;
      health.safeLatestBlock = result.safeLatest;
      health.blocksBehind = Math.max(0, result.safeLatest - result.checkpoint);
      health.lastSuccessfulScanTime = new Date().toISOString();
      health.lastError = null;
      health.currentRpcEndpointRedacted = provider.currentEndpointRedacted;
      health.rpcFailoverCount = provider.rpcFailoverCount;
      console.info(`[blockchain-indexer] checkpoint=${result.checkpoint} safe_latest=${result.safeLatest}`);
    } catch (error) {
      health.lastError = error instanceof Error ? error.message : String(error);
      health.currentRetryDelayMs = 30_000;
    }
    const delay = health.lastError ? 30_000 : config.pollMs;
    if (!stopped) await sleepUntilPoll(delay);
  }
  } finally {
    health.running = false;
    await lockClient.query(
      "SELECT pg_advisory_unlock(hashtext($1),$2)",
      ["smart-earning-registration-indexer", CHAIN_ID],
    ).catch(() => undefined);
    health.lockOwned = false;
    lockClient.release();
  }
}

export function startBlockchainIndexer() {
  if (worker) return worker;
  console.info("[blockchain-indexer] startup", {
    mode: LIVE_INDEXER_MODE,
    source: LIVE_INDEXER_SOURCE,
    gitCommit: process.env.DEPLOYED_GIT_COMMIT || "unknown",
    configuredInitialCheckpoint: blockchainIndexerConfig().startBlock,
  });
  stopped = false;
  worker = run().catch((error) => {
    health.lastError = error instanceof Error ? error.message : String(error);
    health.running = false;
    console.error("[blockchain-indexer] worker stopped", error);
  });
  if (!shutdownBound) {
    shutdownBound = true;
    process.once("SIGTERM", stopBlockchainIndexer);
    process.once("SIGINT", stopBlockchainIndexer);
  }
  return worker;
}

export function stopBlockchainIndexer() {
  stopped = true;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = undefined;
  wakePoll?.();
  wakePoll = undefined;
  health.running = false;
}

export async function blockchainIndexerHealth(): Promise<IndexerHealth> {
  const snapshot = { ...health };
  if (!snapshot.contractAddress) return snapshot;
  try {
    const rpc = new ReadOnlyIndexerRpc(indexerRpcUrls());
    const [state, latest, rpcChainId, contractCode, conflicts] = await Promise.all([
      checkpoints.getLastBlock(snapshot.chainId, snapshot.contractAddress),
      rpc.getBlockNumber(),
      rpc.getChainId(),
      rpc.request<string>("eth_getCode", [snapshot.contractAddress, "latest"]),
      query<{ count: string }>(
        "SELECT count(*)::text count FROM registration_projection_conflicts WHERE resolved_at IS NULL",
      ),
    ]);
    const safe = safeLatestBlock(latest, blockchainIndexerConfig().confirmations);
    const blocksBehind = state === undefined ? null : Math.max(0, safe - state);
    const threshold = positiveInteger("BLOCKCHAIN_INDEXER_MAX_BLOCKS_BEHIND", 20);
    const unresolvedRegistrationConflicts = Number(conflicts.rows[0]?.count || 0);
    const readinessReasons = [
      ...(!snapshot.running ? ["indexer process is not running"] : []),
      ...(!snapshot.lockOwned ? ["indexer ownership lock is not held"] : []),
      ...(rpcChainId !== snapshot.chainId ? ["RPC chain ID does not match configuration"] : []),
      ...(!contractCode || contractCode === "0x" ? ["configured contract has no deployed code"] : []),
      ...(blocksBehind === null || blocksBehind > threshold
        ? [`checkpoint exceeds ${threshold}-block readiness threshold`] : []),
      ...(unresolvedRegistrationConflicts ? ["unresolved registration projection conflict"] : []),
    ];
    return {
      ...snapshot,
      lastProcessedBlock: state ?? null,
      safeLatestBlock: safe,
      blocksBehind,
      unresolvedRegistrationConflicts,
      readinessReasons,
      ready: readinessReasons.length === 0,
    };
  } catch (error) {
    return {
      ...snapshot,
      lastError: snapshot.lastError || (error instanceof Error ? error.message : String(error)),
    };
  }
}
