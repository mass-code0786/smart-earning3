export type IndexerTransaction = {
  hash: string;
  to: string | null;
  transactionIndex?: number;
};

export type IndexerBlock = {
  number: number;
  transactions: IndexerTransaction[];
};

export type IndexerLog = {
  address: string;
  blockNumber: number;
  transactionHash: string;
  index: number;
  transactionIndex?: number;
  topics: readonly string[];
  data: string;
};

export type IndexerReceipt = {
  status: number;
  transactionHash: string;
  blockNumber: number;
  blockHash?: string;
  logs: IndexerLog[];
};

export type IndexerProvider = {
  getBlockNumber(): Promise<number>;
  getBlockWithTransactions(blockNumber: number): Promise<IndexerBlock>;
  getTransactionReceipt(transactionHash: string): Promise<IndexerReceipt>;
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

export function safeLatestBlock(latest: number, confirmations: number) {
  return Math.max(0, latest - confirmations);
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
  provider: Pick<IndexerProvider, "getBlockNumber">;
  checkpoints: IndexerCheckpointStore;
  startBlock?: number;
}) {
  const address = input.contractAddress.toLowerCase();
  const existing = await input.checkpoints.getLastBlock(input.chainId, address);
  const latest = await input.provider.getBlockNumber();
  const safeLatest = safeLatestBlock(latest, input.confirmations);
  if (existing !== undefined) return { checkpoint: existing, safeLatest, initialized: false };
  const initial = input.startBlock === undefined
    ? safeLatest
    : Math.min(input.startBlock, safeLatest);
  const checkpoint = await input.checkpoints.initialize(input.chainId, address, initial);
  return { checkpoint, safeLatest, initialized: true };
}

export async function processConfirmedBlocks(input: {
  chainId: number;
  contractAddress: string;
  confirmations: number;
  provider: IndexerProvider;
  checkpoints: IndexerCheckpointStore;
  processedEvents: ProcessedEventStore;
  eventName(log: IndexerLog): string | undefined;
  handleLog(log: IndexerLog, eventName: string, receipt: IndexerReceipt): Promise<void>;
  onBlock?(result: { blockNumber: number; matchingTransactions: number; eventCount: number }): void;
}) {
  const address = input.contractAddress.toLowerCase();
  const savedCheckpoint = await input.checkpoints.getLastBlock(input.chainId, address);
  if (savedCheckpoint === undefined) throw new Error("Blockchain indexer is not initialized");
  let checkpoint: number = savedCheckpoint;
  const safeLatest = safeLatestBlock(
    await input.provider.getBlockNumber(),
    input.confirmations,
  );
  let eventCount = 0;

  while (checkpoint < safeLatest) {
    const blockNumber = checkpoint + 1;
    const block = await input.provider.getBlockWithTransactions(blockNumber);
    if (block.number !== blockNumber) {
      throw new Error(`RPC returned block ${block.number} while ${blockNumber} was requested`);
    }
    const matching = block.transactions.filter(
      (transaction) => transaction.to?.toLowerCase() === address,
    ).sort((left, right) =>
      (left.transactionIndex ?? 0) - (right.transactionIndex ?? 0)
      || left.hash.localeCompare(right.hash));
    let blockEvents = 0;
    for (const transaction of matching) {
      const receipt = await input.provider.getTransactionReceipt(transaction.hash);
      if (receipt.status !== 1) continue;
      for (const log of [...receipt.logs].sort((left, right) =>
        (left.transactionIndex ?? 0) - (right.transactionIndex ?? 0)
        || left.index - right.index)) {
        if (log.address.toLowerCase() !== address) continue;
        const name = input.eventName(log);
        if (!name) continue;
        if (await input.processedEvents.has(input.chainId, log.transactionHash, log.index)) continue;
        await input.handleLog(log, name, receipt);
        await input.processedEvents.record({
          chainId: input.chainId,
          contractAddress: address,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.index,
          blockNumber: log.blockNumber,
          eventName: name,
        });
        blockEvents += 1;
      }
    }
    await input.checkpoints.commitLastBlock(input.chainId, address, blockNumber);
    checkpoint = blockNumber;
    eventCount += blockEvents;
    input.onBlock?.({
      blockNumber,
      matchingTransactions: matching.length,
      eventCount: blockEvents,
    });
  }
  return { checkpoint, safeLatest, eventCount };
}
