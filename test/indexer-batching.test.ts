// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  historicalBlockRanges,
  indexHistoricalEvents,
  indexerBlockBatchSize,
  type IndexerLog,
} from "@/scripts/indexer-core";

const address = "0x4509301aa843f504936999850f4bcaf57a03cd99";

function log(blockNumber: number, suffix: string, index = 0): IndexerLog {
  return {
    blockNumber,
    transactionHash: `0x${suffix.padStart(64, "0")}`,
    index,
    topics: [],
    data: "0x",
  };
}

function harness(head: number, logs: IndexerLog[]) {
  let cursor: number | undefined;
  const committed: number[] = [];
  const requests: Array<{ fromBlock: number; toBlock: number }> = [];
  return {
    provider: {
      getBlockNumber: vi.fn(async () => head),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: {
        address: string;
        fromBlock: number;
        toBlock: number;
      }) => {
        requests.push({ fromBlock, toBlock });
        return logs.filter((item) => item.blockNumber >= fromBlock && item.blockNumber <= toBlock);
      }),
      getBlock: vi.fn(async (blockNumber: number) => ({ hash: `block-${blockNumber}` })),
    },
    checkpoints: {
      getLastBlock: vi.fn(async () => cursor),
      commitLastBlock: vi.fn(async (
        _chainId: number,
        _contractAddress: string,
        blockNumber: number,
      ) => {
        cursor = blockNumber;
        committed.push(blockNumber);
      }),
    },
    requests,
    committed,
    cursor: () => cursor,
  };
}

describe("BSC Testnet indexer batching", () => {
  it("caps configured and explicit historical ranges at 500 blocks", () => {
    expect(indexerBlockBatchSize("500")).toBe(500);
    expect(indexerBlockBatchSize("5000")).toBe(500);
    expect(historicalBlockRanges(100, 1_349, 5_000)).toEqual([
      { fromBlock: 100, toBlock: 599 },
      { fromBlock: 600, toBlock: 1_099 },
      { fromBlock: 1_100, toBlock: 1_349 },
    ]);
  });

  it("batches across inclusive boundaries without gaps or overlaps", async () => {
    const state = harness(1_101, []);
    await indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 2,
      batchSize: 500,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: vi.fn(),
    });

    expect(state.requests).toEqual([
      { fromBlock: 100, toBlock: 599 },
      { fromBlock: 600, toBlock: 1_099 },
      { fromBlock: 1_100, toBlock: 1_100 },
    ]);
    expect(state.committed).toEqual([599, 1_099, 1_100]);
  });

  it("restarts the failed batch after the last successfully committed cursor", async () => {
    const events = [log(120, "1"), log(620, "2"), log(630, "3")];
    const state = harness(700, events);
    const attempts = new Map<string, number>();
    const failOnce = vi.fn(async (event: IndexerLog) => {
      const count = (attempts.get(event.transactionHash) || 0) + 1;
      attempts.set(event.transactionHash, count);
      if (event.blockNumber === 630 && count === 1) throw new Error("temporary reconciliation failure");
    });

    await expect(indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 1,
      batchSize: 500,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: failOnce,
    })).rejects.toThrow("temporary reconciliation failure");
    expect(state.cursor()).toBe(599);

    await indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 1,
      batchSize: 500,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: failOnce,
    });
    expect(state.requests.at(-1)).toEqual({ fromBlock: 600, toBlock: 700 });
    expect(state.cursor()).toBe(700);
  });

  it("suppresses duplicate RPC log entries within a batch", async () => {
    const paidRegistration = log(120, "abc", 7);
    const state = harness(200, [paidRegistration, paidRegistration]);
    const reconcile = vi.fn(async () => undefined);

    await indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 1,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: reconcile,
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("reconciles an already-paid registration exactly once across a partial restart", async () => {
    const paid = log(620, "paid", 2);
    const later = log(630, "later", 3);
    const state = harness(700, [paid, later]);
    const indexedTxHashes = new Set<string>();
    let registrationRows = 0;
    let failLaterOnce = true;
    const reconcile = async (event: IndexerLog) => {
      if (event === later && failLaterOnce) {
        failLaterOnce = false;
        throw new Error("later event failed");
      }
      if (!indexedTxHashes.has(event.transactionHash)) {
        indexedTxHashes.add(event.transactionHash);
        if (event === paid) registrationRows += 1;
      }
    };

    const run = () => indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 1,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: reconcile,
    });
    await expect(run()).rejects.toThrow("later event failed");
    await run();

    expect(registrationRows).toBe(1);
    expect(indexedTxHashes.has(paid.transactionHash)).toBe(true);
  });

  it("never starts before the deployment block even with an older cursor", async () => {
    const state = harness(150, []);
    state.checkpoints.getLastBlock.mockResolvedValue(0);
    await indexHistoricalEvents({
      chainId: 97,
      contractAddress: address,
      deploymentBlock: 100,
      confirmationsRequired: 1,
      provider: state.provider,
      checkpoints: state.checkpoints,
      handleLog: vi.fn(),
    });
    expect(state.requests[0]).toEqual({ fromBlock: 100, toBlock: 150 });
  });
});
