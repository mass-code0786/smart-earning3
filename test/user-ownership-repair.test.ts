// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const diagnoseUserOwnership = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/user-ownership-diagnostic", () => ({ diagnoseUserOwnership }));
vi.mock("@/lib/server/db", () => ({ transaction }));

const sponsor = "0xeb6cb3735b4def00acbff615b7337f09c4bab37c";
const referral = "0xfd314f3a6e47a802a73da6d620ab3114f14d042f";
const event = {
  transactionHash: `0x${"12".repeat(32)}`,
  transactionSender: referral,
  registeredUser: referral,
  sponsor,
  matrixParent: sponsor,
  matrixIndex: "10",
  matrixPosition: 0,
  directSponsorIncome: "1000000",
  magicWalletCredit: "1000000",
  logIndex: 4,
  blockNumber: 100,
  blockHash: `0x${"34".repeat(32)}`,
  contractAddress: "0x00000000000000000000000000000000000000cc",
};

function diagnostic(correct = false) {
  const registration = {
    id: "registration-id", tx_hash: event.transactionHash,
    user_id: correct ? "referral-id" : "sponsor-id",
    sponsor_user_id: correct ? "sponsor-id" : "referral-id",
  };
  return {
    mode: "READ_ONLY" as const,
    wallets: { sponsor, referral },
    users: [
      { id: "sponsor-id", wallet_address: sponsor },
      { id: "referral-id", wallet_address: referral },
    ],
    duplicateWalletRows: [],
    referralRelations: [{
      id: "relation-id", registration_id: "registration-id",
      user_id: correct ? "referral-id" : "sponsor-id",
      sponsor_user_id: correct ? "sponsor-id" : "referral-id",
    }],
    registrations: [registration],
    matrixPlacements: [{
      id: "placement-id", registration_id: "registration-id",
      user_id: correct ? "referral-id" : "sponsor-id",
      parent_wallet: sponsor,
    }],
    packagePurchases: [],
    activityHistory: [],
    blockchainTransactions: [{
      id: "blockchain-link", tx_hash: event.transactionHash, log_index: event.logIndex,
      from_address: referral, raw_payload: { sponsor },
    }],
    processedBlockchainEvents: [],
    balancesByUser: [],
    ledgerRows: correct ? [] : [{
      source: "income_wallet_ledger", id: "income-id", user_id: "referral-id",
      amount: "900000",
      idempotency_key: `registration:${event.transactionHash}:direct-cap:income`,
    }],
    x3HoldOwnershipProof: correct ? [] : [{
      hold_id: "hold-id", current_user_id: "referral-id",
      expected_user_id: "sponsor-id", cycle_owner_user_id: "sponsor-id",
      package_id: 8, amount: "256000000",
      source_package_purchase_id: "purchase-id", matrix_placed_user_id: "sponsor-id",
    }],
    registrationEvent: event,
    mismatches: correct ? [] : ["REFERRAL_SPONSOR_MISMATCH"],
  };
}

describe("two-wallet ownership repair", () => {
  beforeEach(() => {
    diagnoseUserOwnership.mockReset();
    transaction.mockReset();
  });

  it("enforces the exact sponsor/referral allowlist and parameter order", async () => {
    const { assertOwnershipRepairAllowlist } = await import("@/lib/server/user-ownership-repair");
    expect(assertOwnershipRepairAllowlist(sponsor, referral)).toEqual({ sponsor, referral });
    expect(() => assertOwnershipRepairAllowlist(referral, sponsor)).toThrow("allowlist");
  });

  it("aborts for missing or ambiguous registration events", async () => {
    const { ownershipRepairPlan } = await import("@/lib/server/user-ownership-repair");
    expect(() => ownershipRepairPlan({ ...diagnostic(), registrationEvent: null } as never))
      .toThrow("single confirmed");
    expect(() => ownershipRepairPlan({
      ...diagnostic(), mismatches: ["AMBIGUOUS_REGISTRATION_EVENTS"],
    } as never)).toThrow("More than one");
  });

  it("keeps exact amounts and proposes only proven row ownership changes", async () => {
    const { ownershipRepairPlan } = await import("@/lib/server/user-ownership-repair");
    const plan = ownershipRepairPlan(diagnostic() as never);
    expect(plan.proposedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "income_wallet_ledger", rowId: "income-id",
        amount: "900000", expectedUserId: "sponsor-id",
      }),
      expect.objectContaining({
        table: "x3_hold_ledger", rowId: "hold-id",
        amount: "256000000", expectedUserId: "sponsor-id",
      }),
    ]));
  });

  it("is dry-run by default and already-correct state is a no-op", async () => {
    diagnoseUserOwnership.mockResolvedValueOnce(diagnostic());
    const { repairUserOwnership } = await import("@/lib/server/user-ownership-repair");
    const dryRun = await repairUserOwnership({ sponsor, referral });
    expect(dryRun.applied).toBe(false);
    expect(transaction).not.toHaveBeenCalled();

    diagnoseUserOwnership.mockResolvedValueOnce(diagnostic(true));
    const noOp = await repairUserOwnership({ sponsor, referral, apply: true });
    expect(noOp).toMatchObject({ applied: false, noOp: true });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("first apply is transactional and the second apply is idempotent", async () => {
    diagnoseUserOwnership
      .mockResolvedValueOnce(diagnostic())
      .mockResolvedValueOnce(diagnostic(true))
      .mockResolvedValueOnce(diagnostic(true));
    const client = {
      query: vi.fn(async (sqlInput: string) => {
        const sql = String(sqlInput);
        if (sql.includes("SELECT id,wallet_address FROM users")) return { rows: [
          { id: "referral-id", wallet_address: referral },
          { id: "sponsor-id", wallet_address: sponsor },
        ] };
        if (sql.includes("RETURNING id")) return { rows: [{ id: "registration-id" }], rowCount: 1 };
        if (sql.includes("Decoded matrix parent") || sql.includes("lower(wallet_address)=lower")) {
          return { rows: [{ id: "sponsor-id" }] };
        }
        if (sql.includes("registration_ok")) return { rows: [{
          registration_ok: true, relation_ok: true, placement_ok: true,
          x3_mismatches: 0, sponsor_direct_count: 1, actual_direct_count: 1,
        }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    transaction.mockImplementation(async (callback) => callback(client));
    const { repairUserOwnership } = await import("@/lib/server/user-ownership-repair");
    const first = await repairUserOwnership({ sponsor, referral, apply: true });
    expect(first.applied).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE income_wallet_ledger DISABLE TRIGGER USER",
    );
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE income_wallet_ledger ENABLE TRIGGER USER",
    );
    const second = await repairUserOwnership({ sponsor, referral, apply: true });
    expect(second).toMatchObject({ applied: false, noOp: true });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not insert duplicate financial or activity rows", () => {
    const source = readFileSync(resolve("lib/server/user-ownership-repair.ts"), "utf8");
    expect(source).not.toMatch(/INSERT INTO (?:income_wallet_ledger|magic_wallet_ledger|earning_split_events|activity_history)/);
    expect(source).toContain("direct_count=(");
  });
});
