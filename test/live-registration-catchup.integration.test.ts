// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { processConfirmedBlocks, type IndexerReceipt } from "@/scripts/indexer-core";

describe("live registration while historical replay is behind", () => {
  it("projects immediately and later replay skips the same event without moving checkpoint early", async () => {
    const registrationBlock = 4_000;
    let checkpoint = 1_000;
    const txHash = `0x${"44".repeat(32)}`;
    const projection = {
      users: new Set<string>(), registrations: new Set<string>(),
      referrals: new Set<string>(), placements: new Set<string>(), transactions: new Set<string>(),
      processed: new Set<string>(), directIncome: new Set<string>(), magicCredits: new Set<string>(),
    };
    const eventKey = `${txHash}:7`;

    // This represents the atomic confirmed-receipt projection performed by registration verification.
    for (const table of [
      projection.users, projection.registrations, projection.referrals, projection.placements,
      projection.transactions, projection.directIncome, projection.magicCredits,
    ]) table.add(txHash);
    projection.processed.add(eventKey);

    expect(registrationBlock - checkpoint).toBeGreaterThan(2_000);
    expect(projection.users.has(txHash)).toBe(true); // auth session reports registered
    expect(projection.registrations.has(txHash) && projection.referrals.has(txHash)
      && projection.placements.has(txHash)).toBe(true); // dashboard bootstrap has its owner graph
    expect(checkpoint).toBe(1_000); // direct verification never fast-forwards replay

    const receipt: IndexerReceipt = {
      status: 1, transactionHash: txHash, blockNumber: registrationBlock,
      logs: [{
        address: "0x4509301aa843f504936999850f4bcaf57a03cd99",
        transactionHash: txHash, blockNumber: registrationBlock, index: 7,
        topics: ["registered"], data: "0x",
      }],
    };
    const handleLog = vi.fn(async () => {
      projection.registrations.add(txHash);
      projection.placements.add(txHash);
      projection.directIncome.add(txHash);
      projection.magicCredits.add(txHash);
    });
    await processConfirmedBlocks({
      chainId: 97,
      contractAddress: receipt.logs[0].address,
      confirmations: 3,
      provider: {
        getBlockNumber: async () => registrationBlock + 3,
        getBlockWithTransactions: async blockNumber => ({
          number: blockNumber,
          transactions: blockNumber === registrationBlock
            ? [{ hash: txHash, to: receipt.logs[0].address }] : [],
        }),
        getTransactionReceipt: async () => receipt,
      },
      checkpoints: {
        getLastBlock: async () => checkpoint,
        initialize: async () => checkpoint,
        commitLastBlock: async (_chain, _address, block) => { checkpoint = block; },
      },
      processedEvents: {
        has: async (_chain, hash, index) => projection.processed.has(`${hash}:${index}`),
        record: async event => { projection.processed.add(`${event.transactionHash}:${event.logIndex}`); },
      },
      eventName: log => log.topics[0] === "registered" ? "UserRegistered" : undefined,
      handleLog,
    });

    expect(checkpoint).toBe(registrationBlock);
    expect(handleLog).not.toHaveBeenCalled();
    expect(projection.registrations.size).toBe(1);
    expect(projection.referrals.size).toBe(1);
    expect(projection.placements.size).toBe(1);
    expect(projection.directIncome.size).toBe(1);
    expect(projection.magicCredits.size).toBe(1);
  });

  it("keeps the immediate receipt projection complete and atomic in production code", () => {
    const source = readFileSync(resolve("lib/server/registration-service.ts"), "utf8");
    for (const table of [
      "users", "registrations", "referral_relations", "matrix_placements",
      "blockchain_transactions", "blockchain_processed_events",
      "direct_income_ledger", "magic_wallet_ledger",
    ]) expect(source).toContain(table);
    expect(source).toContain("transaction(async (rawClient)");
    expect(source).toContain("diagnosticRegistrationClient(rawClient, txHash)");
    expect(source).toContain("confirmedOnchainCredit:directIncome");
    expect(source).not.toContain("SPONSOR_NOT_INDEXED");
  });
});
