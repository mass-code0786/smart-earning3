// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { printDiagnosticThenCreateRepairPlan } from "@/lib/server/user-ownership-repair-observability";

const sponsor = "0xeb6cb3735b4def00acbff615b7337f09c4bab37c";
const referral = "0xfd314f3a6e47a802a73da6d620ab3114f14d042f";
const transactionHash = `0x${"12".repeat(32)}`;
const event = {
  transactionHash,
  transactionSender: referral,
  registeredUser: referral,
  sponsor,
  matrixParent: sponsor,
  matrixIndex: "1",
  matrixPosition: 0,
  directSponsorIncome: "1000000",
  magicWalletCredit: "1000000",
  logIndex: 1,
  blockNumber: 100,
  blockHash: `0x${"34".repeat(32)}`,
  contractAddress: "0x00000000000000000000000000000000000000cc",
};

function diagnostic(matchCount: 0 | 1 | 2) {
  const decoded = matchCount === 0 ? [{
    ...event,
    registeredUser: sponsor,
    rejectionReasons: ["event.user mismatch"],
  }] : Array.from({ length: matchCount }, (_, index) => ({
    ...event,
    logIndex: index + 1,
    rejectionReasons: [],
  }));
  return {
    mode: "READ_ONLY",
    wallets: { sponsor, referral },
    users: [
      { id: "sponsor-id", wallet_address: sponsor },
      { id: "referral-id", wallet_address: referral },
    ],
    duplicateWalletRows: [],
    registrations: [],
    referralRelations: [],
    matrixPlacements: [],
    packagePurchases: [],
    activityHistory: [],
    blockchainTransactions: [{ tx_hash: transactionHash }],
    processedBlockchainEvents: [{ transaction_hash: transactionHash }],
    candidateTransactionHashes: [{ transactionHash, sources: ["blockchain_transactions"] }],
    decodedUserRegisteredEvents: decoded,
    eventDiscovery: {
      requiredConfirmedEvents: 1,
      confirmedMatchingEventCount: matchCount,
      candidateTransactionHashes: [{ transactionHash, sources: ["blockchain_transactions"] }],
      candidateReceipts: [{
        transactionHash,
        receiptFetchStatus: "FOUND",
        receiptStatus: 1,
        transactionSender: referral,
        destinationContract: event.contractAddress,
        rejectionReasons: [],
      }],
      decodedUserRegisteredEvents: decoded,
      matchingConfirmedEvents: matchCount === 0 ? [] : decoded,
      lookups: { "transaction receipt": { found: 1, failed: false } },
      lookupFailures: [],
      conclusion: `found ${matchCount}`,
    },
    balancesByUser: [],
    recomputedTeamByUser: [],
    ledgerRows: [],
    x3HoldOwnershipProof: [],
    registrationEvent: matchCount === 1 ? event : null,
    mismatches: matchCount === 2
      ? ["AMBIGUOUS_REGISTRATION_EVENTS"]
      : matchCount === 0 ? ["REGISTRATION_EVENT_NOT_FOUND"] : [],
  };
}

describe("ownership repair diagnostic observability", () => {
  it("prints candidate hashes and decoded events before zero-event failure", () => {
    const output: string[] = [];
    expect(() => printDiagnosticThenCreateRepairPlan(
      diagnostic(0) as never,
      (value) => output.push(value),
    )).toThrow("single confirmed");

    expect(output).toHaveLength(2);
    expect(output[0]).toContain(transactionHash);
    expect(output[0]).toContain('"decodedUserRegisteredEvents"');
    expect(output[0]).toContain('"receiptFetchStatus": "FOUND"');
    expect(output[1]).toContain('"safetyError": "A single confirmed UserRegistered event is required"');
  });

  it("prints diagnostic before multiple-event failure", () => {
    const output: string[] = [];
    expect(() => printDiagnosticThenCreateRepairPlan(
      diagnostic(2) as never,
      (value) => output.push(value),
    )).toThrow("single confirmed");

    expect(output[0]).toContain('"matchingConfirmedEvents"');
    expect(output[1]).toContain('"safetyError"');
  });

  it("continues to the repair plan for exactly one matching event", () => {
    const output: string[] = [];
    const plan = printDiagnosticThenCreateRepairPlan(
      diagnostic(1) as never,
      (value) => output.push(value),
    );

    expect(plan.registrationEvent).toMatchObject({ transactionHash });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('"safetyError": null');
  });

  it("does not enter a write callback after a safety failure", () => {
    const writeDatabase = vi.fn();
    expect(() => {
      printDiagnosticThenCreateRepairPlan(diagnostic(0) as never, () => undefined);
      writeDatabase();
    }).toThrow();
    expect(writeDatabase).not.toHaveBeenCalled();
  });

  it("runs explicit diagnosis and observable planning before the repair entry point", () => {
    const source = readFileSync(resolve("scripts/repair-user-ownership.ts"), "utf8");
    const diagnoseAt = source.indexOf("await diagnoseUserOwnership");
    const planAt = source.indexOf("printDiagnosticThenCreateRepairPlan(diagnostic");
    const repairAt = source.indexOf("await repairUserOwnership");
    expect(diagnoseAt).toBeGreaterThan(-1);
    expect(planAt).toBeGreaterThan(diagnoseAt);
    expect(repairAt).toBeGreaterThan(planAt);
  });
});
