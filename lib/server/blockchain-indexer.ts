import { Interface } from "ethers";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import {
  indexerRpcUrls,
  RateLimitedRpcErrorLogger,
  ReadOnlyIndexerRpc,
} from "@/lib/blockchain/indexer-rpc";
import { CHAIN_ID, getServerConfig } from "./config";
import { query } from "./db";
import { verifyAndActivateRegistration } from "./registration-service";
import { verifyPackagePurchase } from "./package-service";
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
const relevantEvents = ["UserRegistered", "PackagePurchased"] as const;
type IndexerHealth = {
  mode: "block_receipt_indexing";
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
};

const health: IndexerHealth = {
  mode: "block_receipt_indexing",
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
  const mode = (process.env.BLOCKCHAIN_INDEXER_START_MODE || "latest").trim().toLowerCase();
  if (mode !== "latest") throw new Error("BLOCKCHAIN_INDEXER_START_MODE must be latest");
  return {
    confirmations: positiveInteger("BLOCKCHAIN_CONFIRMATIONS", 3),
    pollMs: positiveInteger("BLOCKCHAIN_INDEXER_POLL_MS", 5_000),
    startBlock: configuredStartBlock(),
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
      `INSERT INTO blockchain_indexer_state(chain_id,contract_address,last_processed_block)
       VALUES($1,$2,$3) ON CONFLICT(chain_id,contract_address) DO UPDATE
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

export function decodedIndexerEventName(log: IndexerLog) {
  try {
    const name = iface.parseLog(log)?.name;
    return relevantEvents.includes(name as typeof relevantEvents[number]) ? name : undefined;
  } catch {
    return undefined;
  }
}

async function handleLog(log: IndexerLog, eventName: string, _receipt: IndexerReceipt) {
  const event = iface.parseLog(log);
  if (!event) return;
  if (eventName === "UserRegistered") {
    await verifyAndActivateRegistration(String(event.args.user), log.transactionHash);
  } else if (eventName === "PackagePurchased") {
    await verifyPackagePurchase(String(event.args.user), log.transactionHash);
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
  console.info(
    `[blockchain-indexer] start block=${initialized.checkpoint} safe_latest=${initialized.safeLatest}` +
    ` initialized=${initialized.initialized}`,
  );

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
  health.running = false;
}

export function startBlockchainIndexer() {
  if (worker) return worker;
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
    const [state, latest] = await Promise.all([
      checkpoints.getLastBlock(snapshot.chainId, snapshot.contractAddress),
      new ReadOnlyIndexerRpc(indexerRpcUrls()).getBlockNumber(),
    ]);
    const safe = safeLatestBlock(latest, blockchainIndexerConfig().confirmations);
    return {
      ...snapshot,
      lastProcessedBlock: state ?? null,
      safeLatestBlock: safe,
      blocksBehind: state === undefined ? null : Math.max(0, safe - state),
    };
  } catch (error) {
    return {
      ...snapshot,
      lastError: snapshot.lastError || (error instanceof Error ? error.message : String(error)),
    };
  }
}
