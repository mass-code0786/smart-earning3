// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import {
  findRegistrationTransactionForWallet,
  reconcileRegistrationTransaction,
} from "@/lib/server/registration-tx-reconciliation";
import {
  diagnosticRegistrationClient,
  safePostgreSqlDiagnostic,
} from "@/lib/server/registration-service";
import type { PoolClient } from "pg";

const iface = new Interface(SMART_EARNING_ABI);
const contract = "0x4509301aa843F504936999850f4bCaF57a03Cd99";
const wallet = "0x00000000000000000000000000000000000000A1";
const otherWallet = "0x00000000000000000000000000000000000000b2";
const sponsor = "0x00000000000000000000000000000000000000C3";
const parent = "0x00000000000000000000000000000000000000D4";
const txHash = `0x${"12".repeat(32)}`;

function fixture(overrides: {
  status?: number;
  target?: string;
  eventWallet?: string;
  eventAddress?: string;
  includeEvent?: boolean;
} = {}) {
  const target = overrides.target ?? contract;
  const event = iface.encodeEventLog(iface.getEvent("UserRegistered")!, [
    overrides.eventWallet ?? wallet,
    sponsor,
    parent,
    1n,
    0,
    1_000_000n,
    1_000_000n,
  ]);
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 97n })),
    getBlockNumber: vi.fn(async () => 101),
    getTransaction: vi.fn(async () => ({
      from: wallet,
      to: target,
      data: iface.encodeFunctionData("register", [sponsor]),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      status: overrides.status ?? 1,
      to: target,
      blockNumber: 100,
      blockHash: `0x${"ab".repeat(32)}`,
      logs: overrides.includeEvent === false ? [] : [{
        address: overrides.eventAddress ?? contract,
        index: 0,
        topics: event.topics,
        data: event.data,
      }],
    })),
  };
  return provider;
}

describe("exact BSC Testnet registration transaction reconciliation", () => {
  it("reports the exact failing PostgreSQL operation without logging query parameters", async () => {
    const postgresError = Object.assign(new Error("violates check constraint"), {
      code: "23514",
      constraint: "activity_history_category_check",
      table: "activity_history",
      column: undefined,
      schema: "public",
      detail: "Failing row rejected",
      routine: "ExecConstraints",
    });
    const query = vi.fn(async () => { throw postgresError; });
    const client = diagnosticRegistrationClient({ query } as unknown as PoolClient, txHash);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(client.query(
      "INSERT INTO activity_history(user_wallet) VALUES($1)",
      ["database-password-must-not-be-logged"],
    )).rejects.toBe(postgresError);

    expect(logged).toHaveBeenCalledWith("[registration:postgres-operation]", {
      operation: "INSERT INTO:activity_history",
      txHash,
      success: false,
      ...safePostgreSqlDiagnostic(postgresError),
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("database-password-must-not-be-logged");
    logged.mockRestore();
  });

  it("keeps the registration indexing diagnostic read-only", () => {
    const source = readFileSync(
      resolve("scripts/diagnose-registration-indexing.ts"),
      "utf8",
    );
    expect(source).toContain('mode: "READ_ONLY"');
    expect(source).toContain("blockchain_indexer_state");
    expect(source).toContain("blockchain_processed_events");
    expect(source).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });

  function eventLookupProvider(events: Array<{ hash: string; eventWallet?: string; status?: number }>) {
    return {
      getNetwork: vi.fn(async () => ({ chainId: 97n })),
      getBlockNumber: vi.fn(async () => 121728500),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) =>
        events.map((item, index) => {
          const blockNumber = 121722400 + (index * 3_100);
          if (blockNumber < fromBlock || blockNumber > toBlock) return null;
        const encoded = iface.encodeEventLog(iface.getEvent("UserRegistered")!, [
          item.eventWallet ?? wallet, sponsor, parent, 1n, 0, 1_000_000n, 1_000_000n,
        ]);
        return {
          address: contract,
          transactionHash: item.hash,
          blockNumber,
          topics: encoded.topics,
          data: encoded.data,
        };
        }).filter((item) => item !== null)),
      getTransactionReceipt: vi.fn(async (hash: string) => {
        const item = events.find((candidate) => candidate.hash === hash);
        return { status: item?.status ?? 1, to: contract, logs: [] };
      }),
    };
  }

  it("finds exactly one confirmed registration event for an exact wallet", async () => {
    const provider = eventLookupProvider([{ hash: txHash }]);
    await expect(findRegistrationTransactionForWallet(wallet, {
      provider,
      contractAddress: contract,
      deploymentBlock: 121722387,
    })).resolves.toEqual({
      txHash,
      blockNumber: 121722400,
      wallet: wallet.toLowerCase(),
      sponsor: sponsor.toLowerCase(),
      matrixParent: parent.toLowerCase(),
      matrixIndex: "1",
      matrixPosition: 0,
      contractAddress: contract.toLowerCase(),
    });
    expect(provider.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      address: contract.toLowerCase(),
      fromBlock: 121722387,
      toBlock: 121725386,
    }));
    expect(provider.getLogs).toHaveBeenCalledTimes(3);
  });

  it("stops safely when no confirmed registration event exists", async () => {
    await expect(findRegistrationTransactionForWallet(wallet, {
      provider: eventLookupProvider([]),
      contractAddress: contract,
      deploymentBlock: 121722387,
    })).rejects.toMatchObject({ code: "REGISTRATION_EVENT_NOT_FOUND", status: 404 });
  });

  it("stops safely instead of guessing between multiple registration events", async () => {
    await expect(findRegistrationTransactionForWallet(wallet, {
      provider: eventLookupProvider([
        { hash: txHash },
        { hash: `0x${"34".repeat(32)}` },
      ]),
      contractAddress: contract,
      deploymentBlock: 121722387,
    })).rejects.toMatchObject({ code: "MULTIPLE_REGISTRATION_EVENTS", status: 409 });
  });

  it("halves block ranges automatically after RPC limit exceeded responses", async () => {
    const provider = eventLookupProvider([{ hash: txHash }]);
    const normalGetLogs = provider.getLogs.getMockImplementation()!;
    provider.getLogs.mockImplementation(async (filter) => {
      const size = filter.toBlock - filter.fromBlock + 1;
      if (size > 375) {
        throw Object.assign(new Error("limit exceeded"), { code: -32005 });
      }
      return normalGetLogs(filter);
    });

    await expect(findRegistrationTransactionForWallet(wallet, {
      provider,
      contractAddress: contract,
      deploymentBlock: 121722387,
      retryDelayMs: 0,
    })).resolves.toMatchObject({ txHash, wallet: wallet.toLowerCase() });
    expect(provider.getLogs.mock.calls.slice(0, 4).map(([filter]) =>
      filter.toBlock - filter.fromBlock + 1)).toEqual([3_000, 1_500, 750, 375]);
    expect(provider.getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it("falls back to one-block scans when that is the provider limit", async () => {
    const provider = eventLookupProvider([{ hash: txHash }]);
    provider.getBlockNumber.mockResolvedValue(121722400);
    const normalGetLogs = provider.getLogs.getMockImplementation()!;
    provider.getLogs.mockImplementation(async (filter) => {
      if (filter.toBlock > filter.fromBlock) {
        throw Object.assign(new Error("limit exceeded"), { code: -32005 });
      }
      return normalGetLogs(filter);
    });

    await expect(findRegistrationTransactionForWallet(wallet, {
      provider,
      contractAddress: contract,
      deploymentBlock: 121722399,
      retryDelayMs: 0,
    })).resolves.toMatchObject({ txHash });
    expect(provider.getLogs.mock.calls.some(([filter]) =>
      filter.fromBlock === filter.toBlock)).toBe(true);
    expect(provider.getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it("validates and reconciles one successful paid registration transaction", async () => {
    const verifyRegistration = vi.fn(async () => ({
      registrationId: "registration-1",
      status: "CONFIRMED",
      duplicate: false,
    }));

    await expect(reconcileRegistrationTransaction(txHash, {
      provider: fixture(),
      verifyRegistration,
      contractAddress: contract,
    })).resolves.toEqual({
      txHash,
      wallet: wallet.toLowerCase(),
      sponsor: sponsor.toLowerCase(),
      matrixParent: parent.toLowerCase(),
      matrixIndex: "1",
      matrixPosition: 0,
      registrationId: "registration-1",
      status: "CONFIRMED",
      alreadyReconciled: false,
    });
    expect(verifyRegistration).toHaveBeenCalledWith(
      wallet.toLowerCase(), txHash,
      expect.objectContaining({ latestBlock: 101 }),
    );
  });

  it("rejects a failed transaction", async () => {
    await expect(reconcileRegistrationTransaction(txHash, {
      provider: fixture({ status: 0 }),
      verifyRegistration: vi.fn(),
      contractAddress: contract,
    })).rejects.toMatchObject({ code: "TX_REVERTED", status: 422 });
  });

  it("rejects a transaction sent to another contract", async () => {
    await expect(reconcileRegistrationTransaction(txHash, {
      provider: fixture({ target: otherWallet }),
      verifyRegistration: vi.fn(),
      contractAddress: contract,
    })).rejects.toMatchObject({ code: "WRONG_CONTRACT", status: 422 });
  });

  it("rejects a receipt without the configured contract UserRegistered event", async () => {
    await expect(reconcileRegistrationTransaction(txHash, {
      provider: fixture({ includeEvent: false }),
      verifyRegistration: vi.fn(),
      contractAddress: contract,
    })).rejects.toMatchObject({ code: "EVENT_NOT_FOUND", status: 422 });
  });

  it("rejects an event for a wallet other than the transaction sender", async () => {
    await expect(reconcileRegistrationTransaction(txHash, {
      provider: fixture({ eventWallet: otherWallet }),
      verifyRegistration: vi.fn(),
      contractAddress: contract,
    })).rejects.toMatchObject({ code: "WALLET_MISMATCH", status: 403 });
  });

  it("returns an already-reconciled result on duplicate execution", async () => {
    const verifyRegistration = vi.fn()
      .mockResolvedValueOnce({
        registrationId: "registration-1",
        status: "CONFIRMED",
        duplicate: false,
      })
      .mockResolvedValueOnce({
        registrationId: "registration-1",
        status: "CONFIRMED",
        duplicate: true,
      });
    const dependencies = {
      provider: fixture(),
      verifyRegistration,
      contractAddress: contract,
    };

    const first = await reconcileRegistrationTransaction(txHash, dependencies);
    const second = await reconcileRegistrationTransaction(txHash, dependencies);
    expect(first.alreadyReconciled).toBe(false);
    expect(second).toMatchObject({
      registrationId: first.registrationId,
      status: "CONFIRMED",
      alreadyReconciled: true,
    });
  });

  it("dry-runs one exact transaction and reports missing projections without writing", async () => {
    const verifyRegistration = vi.fn();
    const inspectProjection = vi.fn(async () => ({
      user_exists: true,
      registration_exists: true,
      relation_exists: false,
      relation_count: 0,
      history_exists: false,
      history_count: 0,
      sponsor_direct_count: 0,
      placement_count: 1,
      matrix_parent_indexed: true,
      expected_placement_exists: true,
      direct_income_count: 1,
      magic_credit_count: 1,
      missing: ["referral_relation", "direct_referral_history"],
    }));
    const result = await reconcileRegistrationTransaction(txHash, {
      provider: fixture(),
      verifyRegistration,
      inspectProjection,
      contractAddress: contract,
      dryRun: true,
    });
    expect(result).toMatchObject({
      dryRun: true,
      wallet: wallet.toLowerCase(),
      sponsor: sponsor.toLowerCase(),
      projection: {
        missing: ["referral_relation", "direct_referral_history"],
        direct_income_count: 1,
        magic_credit_count: 1,
      },
      matrixParent: parent.toLowerCase(),
      matrixIndex: "1",
      matrixPosition: 0,
    });
    expect(verifyRegistration).not.toHaveBeenCalled();
  });
});
