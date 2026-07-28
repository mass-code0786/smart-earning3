export const DEFAULT_INDEXER_BLOCK_BATCH_SIZE = 500;
export const MAX_INDEXER_BLOCK_BATCH_SIZE = 500;

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
  }): Promise<IndexerLog[]>;
  getBlock(blockNumber: number): Promise<{ hash?: string | null } | null>;
};

export type IndexerCheckpointStore = {
  getLastBlock(chainId: number, contractAddress: string): Promise<number | undefined>;
  commitLastBlock(
    chainId: number,
    contractAddress: string,
    blockNumber: number,
    blockHash: string | null,
  ): Promise<void>;
};

export function indexerBlockBatchSize(value = process.env.INDEXER_BLOCK_BATCH_SIZE) {
  if (value === undefined || value.trim() === "") return DEFAULT_INDEXER_BLOCK_BATCH_SIZE;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("INDEXER_BLOCK_BATCH_SIZE must be a positive integer");
  }
  return Math.min(parsed, MAX_INDEXER_BLOCK_BATCH_SIZE);
}

export function historicalBlockRanges(fromBlock: number, toBlock: number, batchSize: number) {
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || fromBlock < 0) {
    throw new Error("Indexer block range is invalid");
  }
  const safeBatchSize = Math.min(indexerBlockBatchSize(String(batchSize)), MAX_INDEXER_BLOCK_BATCH_SIZE);
  const ranges: Array<{ fromBlock: number; toBlock: number }> = [];
  for (let start = fromBlock; start <= toBlock; start += safeBatchSize) {
    ranges.push({ fromBlock: start, toBlock: Math.min(start + safeBatchSize - 1, toBlock) });
  }
  return ranges;
}

export async function indexHistoricalEvents(input: {
  chainId: number;
  contractAddress: string;
  deploymentBlock: number;
  confirmationsRequired: number;
  batchSize?: number;
  provider: IndexerProvider;
  checkpoints: IndexerCheckpointStore;
  handleLog(log: IndexerLog): Promise<void>;
}) {
  if (!Number.isSafeInteger(input.deploymentBlock) || input.deploymentBlock < 1) {
    throw new Error("SMART_EARNING_DEPLOYMENT_BLOCK must be a positive integer");
  }
  const address = input.contractAddress.toLowerCase();
  const head = await input.provider.getBlockNumber();
  const safeHead = head - input.confirmationsRequired + 1;
  const checkpoint = await input.checkpoints.getLastBlock(input.chainId, address);
  const fromBlock = Math.max(input.deploymentBlock, checkpoint === undefined
    ? input.deploymentBlock
    : checkpoint + 1);
  if (fromBlock > safeHead) return;

  for (const range of historicalBlockRanges(
    fromBlock,
    safeHead,
    input.batchSize ?? indexerBlockBatchSize(),
  )) {
    const logs = await input.provider.getLogs({ address, ...range });
    const seen = new Set<string>();
    for (const log of logs) {
      const eventKey = `${log.transactionHash.toLowerCase()}:${log.index}`;
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      await input.handleLog(log);
    }
    const block = await input.provider.getBlock(range.toBlock);
    await input.checkpoints.commitLastBlock(
      input.chainId,
      address,
      range.toBlock,
      block?.hash || null,
    );
  }
}
