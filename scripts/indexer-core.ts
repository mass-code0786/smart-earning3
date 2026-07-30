export const DEFAULT_INDEXER_BLOCK_BATCH_SIZE = 100;
export const MAX_INDEXER_BLOCK_BATCH_SIZE = 200;
export const MIN_INDEXER_BLOCK_BATCH_SIZE = 1;

export type IndexerLog = {
  blockNumber: number;
  transactionHash: string;
  index: number;
  topics: readonly string[];
  data: string;
};

export type IndexerProvider = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: {
    address: string;
    fromBlock: number;
    toBlock: number;
    topics?: Array<string | string[] | null>;
  }): Promise<IndexerLog[]>;
};

export type IndexerCheckpointStore = {
  getLastBlock(chainId: number, contractAddress: string): Promise<number | undefined>;
  initialize(chainId: number, contractAddress: string, blockNumber: number): Promise<number>;
  commitLastBlock(chainId: number, contractAddress: string, blockNumber: number): Promise<void>;
};

export type ProcessedEventStore = {
  has(chainId: number, transactionHash: string, logIndex: number): Promise<boolean>;
  record(input: {
    chainId: number;
    contractAddress: string;
    transactionHash: string;
    logIndex: number;
    blockNumber: number;
    eventName: string;
  }): Promise<void>;
};

export function indexerBlockBatchSize(value = process.env.INDEXER_BLOCK_BATCH_SIZE) {
  if (value === undefined || value.trim() === "") return DEFAULT_INDEXER_BLOCK_BATCH_SIZE;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("INDEXER_BLOCK_BATCH_SIZE must be a positive integer");
  }
  return Math.min(parsed, MAX_INDEXER_BLOCK_BATCH_SIZE);
}

export function safeLatestBlock(latest: number, confirmations: number) {
  return Math.max(0, latest - confirmations);
}

export function isReducibleRpcError(error: unknown) {
  const candidate = error as {
    code?: string | number; status?: number; message?: string;
    error?: { code?: string | number; message?: string };
  };
  const code = candidate?.code ?? candidate?.error?.code;
  const message = `${candidate?.message || ""} ${candidate?.error?.message || ""}`.toLowerCase();
  return code === -32005 || code === "-32005" || candidate?.status === 429
    || message.includes("429") || message.includes("timeout")
    || message.includes("limit exceeded") || message.includes("rate limit")
    || message.includes("too many requests");
}

export function configuredStartBlock(value = process.env.BLOCKCHAIN_INDEXER_START_BLOCK) {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("BLOCKCHAIN_INDEXER_START_BLOCK must be a non-negative integer");
  }
  return parsed;
}

export async function initializeForwardIndexer(input: {
  chainId: number;
  contractAddress: string;
  confirmations: number;
  provider: IndexerProvider;
  checkpoints: IndexerCheckpointStore;
  startBlock?: number;
}) {
  const address = input.contractAddress.toLowerCase();
  const existing = await input.checkpoints.getLastBlock(input.chainId, address);
  const latest = await input.provider.getBlockNumber();
  const safeLatest = safeLatestBlock(latest, input.confirmations);
  if (existing !== undefined) return { checkpoint: existing, safeLatest, initialized: false };
  const requested = input.startBlock;
  const initial = requested === undefined ? safeLatest : Math.min(requested, safeLatest);
  const checkpoint = await input.checkpoints.initialize(input.chainId, address, initial);
  return { checkpoint, safeLatest, initialized: true };
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function processForwardRanges(input: {
  chainId: number;
  contractAddress: string;
  confirmations: number;
  batchSize: number;
  maxRetries?: number;
  provider: IndexerProvider;
  checkpoints: IndexerCheckpointStore;
  processedEvents: ProcessedEventStore;
  topics?: Array<string | string[] | null>;
  eventName(log: IndexerLog): string | undefined;
  handleLog(log: IndexerLog, eventName: string): Promise<void>;
  onRange?(result: { fromBlock: number; toBlock: number; eventCount: number }): void;
  onRetry?(result: { fromBlock: number; toBlock: number; chunkSize: number; error: unknown }): void;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const address = input.contractAddress.toLowerCase();
  let checkpoint = await input.checkpoints.getLastBlock(input.chainId, address);
  if (checkpoint === undefined) throw new Error("Blockchain indexer is not initialized");
  const latest = await input.provider.getBlockNumber();
  const safeLatest = safeLatestBlock(latest, input.confirmations);
  let chunkSize = Math.min(input.batchSize, MAX_INDEXER_BLOCK_BATCH_SIZE);
  let eventCount = 0;

  while (checkpoint < safeLatest) {
    const fromBlock = checkpoint + 1;
    let toBlock = Math.min(fromBlock + chunkSize - 1, safeLatest);
    let logs: IndexerLog[] | undefined;
    let attempt = 0;
    while (!logs) {
      try {
        logs = await input.provider.getLogs({
          address, fromBlock, toBlock, topics: input.topics,
        });
      } catch (error) {
        if (!isReducibleRpcError(error) || attempt >= (input.maxRetries ?? 5)) throw error;
        chunkSize = Math.max(MIN_INDEXER_BLOCK_BATCH_SIZE, Math.floor(chunkSize / 2));
        toBlock = Math.min(fromBlock + chunkSize - 1, safeLatest);
        input.onRetry?.({ fromBlock, toBlock, chunkSize, error });
        await (input.sleep ?? delay)(Math.min(500 * 2 ** attempt, 8_000));
        attempt += 1;
      }
    }

    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    let rangeEvents = 0;
    for (const log of logs) {
      const name = input.eventName(log);
      if (!name) continue;
      if (await input.processedEvents.has(input.chainId, log.transactionHash, log.index)) continue;
      await input.handleLog(log, name);
      await input.processedEvents.record({
        chainId: input.chainId,
        contractAddress: address,
        transactionHash: log.transactionHash.toLowerCase(),
        logIndex: log.index,
        blockNumber: log.blockNumber,
        eventName: name,
      });
      rangeEvents += 1;
    }
    await input.checkpoints.commitLastBlock(input.chainId, address, toBlock);
    checkpoint = toBlock;
    eventCount += rangeEvents;
    input.onRange?.({ fromBlock, toBlock, eventCount: rangeEvents });
  }
  return { checkpoint, safeLatest, eventCount };
}

// Retained as a compatibility helper for existing tests/callers. New runtime code is forward-only.
export function historicalBlockRanges(fromBlock: number, toBlock: number, batchSize: number) {
  const ranges: Array<{ fromBlock: number; toBlock: number }> = [];
  const size = Math.min(indexerBlockBatchSize(String(batchSize)), MAX_INDEXER_BLOCK_BATCH_SIZE);
  for (let start = fromBlock; start <= toBlock; start += size) {
    ranges.push({ fromBlock: start, toBlock: Math.min(start + size - 1, toBlock) });
  }
  return ranges;
}
