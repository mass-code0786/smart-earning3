// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  initializeForwardIndexer,
  processForwardRanges,
  safeLatestBlock,
  type IndexerLog,
} from "@/scripts/indexer-core";

const address = "0x4509301aa843f504936999850f4bcaf57a03cd99";
const event = (blockNumber: number, suffix: string, index = 0): IndexerLog => ({
  blockNumber,
  transactionHash: `0x${suffix.padStart(64, "0")}`,
  index,
  topics: ["registered"],
  data: "0x",
});

function harness(head: number, logs: IndexerLog[] = [], initial?: number) {
  let checkpoint = initial;
  const processed = new Set<string>();
  const commits: number[] = [];
  const requests: Array<{ fromBlock: number; toBlock: number }> = [];
  const provider = {
    getBlockNumber: vi.fn(async () => head),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) => {
      requests.push({ fromBlock, toBlock });
      return logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    }),
  };
  const checkpoints = {
    getLastBlock: vi.fn(async () => checkpoint),
    initialize: vi.fn(async (_chain: number, _contract: string, block: number) => {
      if (checkpoint === undefined) checkpoint = block;
      return checkpoint;
    }),
    commitLastBlock: vi.fn(async (_chain: number, _contract: string, block: number) => {
      checkpoint = block;
      commits.push(block);
    }),
  };
  const processedEvents = {
    has: vi.fn(async (_chain: number, hash: string, index: number) =>
      processed.has(`${hash.toLowerCase()}:${index}`)),
    record: vi.fn(async (input: { transactionHash: string; logIndex: number }) => {
      processed.add(`${input.transactionHash.toLowerCase()}:${input.logIndex}`);
    }),
  };
  return { provider, checkpoints, processedEvents, commits, requests, checkpoint: () => checkpoint };
}

const run = (
  state: ReturnType<typeof harness>,
  handleLog: (log: IndexerLog, eventName: string) => Promise<void> =
    vi.fn(async () => undefined),
) =>
  processForwardRanges({
    chainId: 97,
    contractAddress: address,
    confirmations: 3,
    batchSize: 100,
    provider: state.provider,
    checkpoints: state.checkpoints,
    processedEvents: state.processedEvents,
    eventName: () => "UserRegistered",
    handleLog,
    sleep: async () => undefined,
  });

describe("forward-only BSC Testnet indexer", () => {
  it("first run checkpoints safe latest and ignores older events", async () => {
    const old = event(90, "1");
    const state = harness(100, [old]);
    const initialized = await initializeForwardIndexer({
      chainId: 97, contractAddress: address, confirmations: 3,
      provider: state.provider, checkpoints: state.checkpoints,
    });
    expect(initialized).toEqual({ checkpoint: 97, safeLatest: 97, initialized: true });
    const handle = vi.fn();
    await run(state, handle);
    expect(state.requests).toEqual([]);
    expect(handle).not.toHaveBeenCalled();
  });

  it("processes the next confirmed registration and resumes after restart", async () => {
    const registration = event(98, "2", 4);
    const state = harness(101, [registration], 97);
    const handle = vi.fn(async () => undefined);
    await run(state, handle);
    expect(handle).toHaveBeenCalledOnce();
    expect(state.checkpoint()).toBe(98);
    state.provider.getBlockNumber.mockResolvedValue(103);
    await run(state, handle);
    expect(state.requests.at(-1)).toEqual({ fromBlock: 99, toBlock: 100 });
  });

  it("does not advance a checkpoint after a failed range", async () => {
    const state = harness(110, [event(105, "3")], 100);
    await expect(run(state, vi.fn(async () => {
      throw new Error("projection failed");
    }))).rejects.toThrow("projection failed");
    expect(state.checkpoint()).toBe(100);
    expect(state.commits).toEqual([]);
  });

  it("does not reprocess a duplicate event after a partial restart", async () => {
    const first = event(101, "4", 1);
    const second = event(102, "5", 2);
    const state = harness(105, [first, second], 100);
    let failSecond = true;
    const handle = vi.fn(async (log: IndexerLog) => {
      if (log === second && failSecond) {
        failSecond = false;
        throw new Error("later event failed");
      }
    });
    await expect(run(state, handle)).rejects.toThrow("later event failed");
    await run(state, handle);
    expect(handle.mock.calls.filter(([log]) => log === first)).toHaveLength(1);
    expect(handle.mock.calls.filter(([log]) => log === second)).toHaveLength(2);
  });

  it("respects confirmation depth", async () => {
    expect(safeLatestBlock(100, 3)).toBe(97);
    const state = harness(100, [event(98, "6")], 97);
    const handle = vi.fn();
    await run(state, handle);
    expect(handle).not.toHaveBeenCalled();
    expect(state.requests).toEqual([]);
  });

  it("reduces an RPC-limited range and never skips blocks", async () => {
    const state = harness(203, [], 100);
    state.provider.getLogs
      .mockRejectedValueOnce(Object.assign(new Error("limit exceeded"), { code: -32005 }))
      .mockResolvedValue([]);
    await run(state);
    expect(state.provider.getLogs.mock.calls.map(([filter]) => ({
      fromBlock: filter.fromBlock, toBlock: filter.toBlock,
    }))).toEqual([
      { fromBlock: 101, toBlock: 200 },
      { fromBlock: 101, toBlock: 150 },
      { fromBlock: 151, toBlock: 200 },
    ]);
    expect(state.checkpoint()).toBe(200);
  });

  it("manual start block is used only when no saved checkpoint exists", async () => {
    const fresh = harness(100, [], undefined);
    expect((await initializeForwardIndexer({
      chainId: 97, contractAddress: address, confirmations: 3,
      provider: fresh.provider, checkpoints: fresh.checkpoints, startBlock: 80,
    })).checkpoint).toBe(80);
    const resumed = harness(100, [], 91);
    expect((await initializeForwardIndexer({
      chainId: 97, contractAddress: address, confirmations: 3,
      provider: resumed.provider, checkpoints: resumed.checkpoints, startBlock: 80,
    })).checkpoint).toBe(91);
  });
});
