// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { reconcileRegistrationTransaction } from "@/lib/server/registration-tx-reconciliation";

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
    getTransaction: vi.fn(async () => ({
      from: wallet,
      to: target,
      data: iface.encodeFunctionData("register", [sponsor]),
    })),
    getTransactionReceipt: vi.fn(async () => ({
      status: overrides.status ?? 1,
      to: target,
      logs: overrides.includeEvent === false ? [] : [{
        address: overrides.eventAddress ?? contract,
        topics: event.topics,
        data: event.data,
      }],
    })),
  };
  return provider;
}

describe("exact BSC Testnet registration transaction reconciliation", () => {
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
      registrationId: "registration-1",
      status: "CONFIRMED",
      alreadyReconciled: false,
    });
    expect(verifyRegistration).toHaveBeenCalledWith(wallet.toLowerCase(), txHash);
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
      history_exists: false,
      placement_count: 1,
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
    });
    expect(verifyRegistration).not.toHaveBeenCalled();
  });
});
