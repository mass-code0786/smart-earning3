// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  initializeForwardIndexer,
  processConfirmedBlocks,
  safeLatestBlock,
  type IndexerBlock,
  type IndexerLog,
  type IndexerReceipt,
} from "@/scripts/indexer-core";

const contract = "0x4509301aa843f504936999850f4bcaf57a03cd99";
const unrelated = "0x0000000000000000000000000000000000000001";
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}`;

function log(block: number, tx: string, index: number, topic: string): IndexerLog {
  return {
    address: contract, blockNumber: block, transactionHash: tx,
    index, topics: [topic], data: "0x",
  };
}

function harness(input: {
  head: number;
  checkpoint?: number;
  blocks?: Record<number, IndexerBlock>;
  receipts?: Record<string, IndexerReceipt>;
}) {
  let checkpoint = input.checkpoint;
  const processed = new Set<string>();
  const provider = {
    getBlockNumber: vi.fn(async () => input.head),
    getBlockWithTransactions: vi.fn(async (blockNumber: number) => {
      const block = input.blocks?.[blockNumber];
      if (!block) return { number: blockNumber, transactions: [] };
      return block;
    }),
    getTransactionReceipt: vi.fn(async (txHash: string) => {
      const receipt = input.receipts?.[txHash];
      if (!receipt) throw new Error("missing receipt fixture");
      return receipt;
    }),
  };
  const checkpoints = {
    getLastBlock: vi.fn(async () => checkpoint),
    initialize: vi.fn(async (_chain: number, _address: string, block: number) => {
      if (checkpoint === undefined) checkpoint = block;
      return checkpoint;
    }),
    commitLastBlock: vi.fn(async (_chain: number, _address: string, block: number) => {
      checkpoint = block;
    }),
  };
  const processedEvents = {
    has: vi.fn(async (_chain: number, txHash: string, index: number) =>
      processed.has(`${txHash.toLowerCase()}:${index}`)),
    record: vi.fn(async (event: { transactionHash: string; logIndex: number }) => {
      processed.add(`${event.transactionHash.toLowerCase()}:${event.logIndex}`);
    }),
  };
  return { provider, checkpoints, processedEvents, checkpoint: () => checkpoint };
}

function run(
  state: ReturnType<typeof harness>,
  handler: (log: IndexerLog, eventName: string, receipt: IndexerReceipt) => Promise<void> =
    vi.fn(async () => undefined),
) {
  return processConfirmedBlocks({
    chainId: 97, contractAddress: contract, confirmations: 3,
    provider: state.provider, checkpoints: state.checkpoints,
    processedEvents: state.processedEvents,
    eventName: (entry) => entry.topics[0] === "registered"
      ? "UserRegistered"
      : entry.topics[0] === "package" ? "PackagePurchased" : undefined,
    handleLog: handler,
  });
}

describe("block receipt live indexer", () => {
  it("first run checkpoints safe latest and ignores old blocks", async () => {
    const state = harness({ head: 100 });
    await expect(initializeForwardIndexer({
      chainId: 97, contractAddress: contract, confirmations: 3,
      provider: state.provider, checkpoints: state.checkpoints,
    })).resolves.toEqual({ checkpoint: 97, safeLatest: 97, initialized: true });
    await run(state);
    expect(state.provider.getBlockWithTransactions).not.toHaveBeenCalled();
  });

  it("processes new UserRegistered and PackagePurchased receipt logs", async () => {
    const registrationTx = hash("1");
    const packageTx = hash("2");
    const state = harness({
      head: 101, checkpoint: 97,
      blocks: {
        98: {
          number: 98,
          transactions: [
            { hash: registrationTx, to: contract },
            { hash: packageTx, to: contract.toUpperCase() },
          ],
        },
      },
      receipts: {
        [registrationTx]: {
          status: 1, transactionHash: registrationTx, blockNumber: 98,
          logs: [log(98, registrationTx, 1, "registered")],
        },
        [packageTx]: {
          status: 1, transactionHash: packageTx, blockNumber: 98,
          logs: [log(98, packageTx, 2, "package")],
        },
      },
    });
    const handler = vi.fn(async (
      _log: IndexerLog,
      _eventName: string,
      _receipt: IndexerReceipt,
    ) => undefined);
    await run(state, handler);
    expect(handler.mock.calls.map(([, name]) => name))
      .toEqual(["UserRegistered", "PackagePurchased"]);
    expect(state.checkpoint()).toBe(98);
  });

  it("does not fetch receipts for unrelated transactions", async () => {
    const state = harness({
      head: 101, checkpoint: 97,
      blocks: {
        98: { number: 98, transactions: [{ hash: hash("3"), to: unrelated }] },
      },
    });
    await run(state);
    expect(state.provider.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("does not advance after a failed block fetch", async () => {
    const state = harness({ head: 101, checkpoint: 97 });
    state.provider.getBlockWithTransactions.mockRejectedValueOnce(new Error("temporary block error"));
    await expect(run(state)).rejects.toThrow("temporary block error");
    expect(state.checkpoint()).toBe(97);
  });

  it("does not advance after a failed receipt fetch", async () => {
    const tx = hash("4");
    const state = harness({
      head: 101, checkpoint: 97,
      blocks: { 98: { number: 98, transactions: [{ hash: tx, to: contract }] } },
    });
    await expect(run(state)).rejects.toThrow("missing receipt fixture");
    expect(state.checkpoint()).toBe(97);
  });

  it("restart resumes after the saved checkpoint without skipping blocks", async () => {
    const state = harness({ head: 103, checkpoint: 98 });
    await run(state);
    expect(state.provider.getBlockWithTransactions.mock.calls.map(([block]) => block))
      .toEqual([99, 100]);
    expect(state.checkpoint()).toBe(100);
  });

  it("duplicate processed logs are harmless", async () => {
    const tx = hash("5");
    const state = harness({
      head: 101, checkpoint: 97,
      blocks: { 98: { number: 98, transactions: [{ hash: tx, to: contract }] } },
      receipts: {
        [tx]: {
          status: 1, transactionHash: tx, blockNumber: 98,
          logs: [log(98, tx, 1, "registered"), log(98, tx, 1, "registered")],
        },
      },
    });
    const handler = vi.fn(async () => undefined);
    await run(state, handler);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("respects confirmation depth", async () => {
    expect(safeLatestBlock(100, 3)).toBe(97);
    const state = harness({ head: 100, checkpoint: 97 });
    await run(state);
    expect(state.provider.getBlockWithTransactions).not.toHaveBeenCalled();
  });

  it("saved checkpoint overrides a manual first-start block", async () => {
    const state = harness({ head: 100, checkpoint: 90 });
    const initialized = await initializeForwardIndexer({
      chainId: 97, contractAddress: contract, confirmations: 3,
      provider: state.provider, checkpoints: state.checkpoints, startBlock: 80,
    });
    expect(initialized.checkpoint).toBe(90);
  });
});
