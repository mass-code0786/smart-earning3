// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const recordReferralHistory = vi.hoisted(() => vi.fn()
  .mockResolvedValueOnce({ id: "history-ab", duplicate: false })
  .mockResolvedValue({ id: null, duplicate: true }));
vi.mock("@/lib/server/history-service", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server/history-service")>(),
  recordReferralHistory,
}));

import { reconcileExistingRegistrationProjection } from "@/lib/server/registration-service";

const input = {
  registrationId: "registration-b",
  status: "CONFIRMED",
  userId: "user-b",
  sponsorUserId: "user-a",
  wallet: "0x00000000000000000000000000000000000000bb",
  sponsor: "0x00000000000000000000000000000000000000aa",
  txHash: `0x${"12".repeat(32)}`,
  blockNumber: 123,
  confirmedAt: new Date("2026-07-29T00:00:00Z"),
  blockHash: `0x${"34".repeat(32)}`,
  logIndex: 7,
  confirmations: 3,
  contractAddress: "0x00000000000000000000000000000000000000cc",
};

describe("idempotent confirmed-registration projection repair", () => {
  it("repairs only relation, direct count, and direct-referral history and is rerunnable", async () => {
    let inserted = false;
    const sql: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        sql.push(text);
        if (text.startsWith("INSERT INTO referral_relations")) {
          if (inserted) return { rows: [] };
          inserted = true;
          return { rows: [{ id: "relation-ab" }] };
        }
        if (text.startsWith("SELECT id,sponsor_user_id")) {
          return { rows: [{
            id: "relation-ab", sponsor_user_id: "user-a", registration_id: "registration-b",
          }] };
        }
        return { rows: [] };
      }),
    };

    await expect(reconcileExistingRegistrationProjection(client as never, input))
      .resolves.toEqual({
        relationCreated: true, historyCreated: true, placementCreated: false,
      });
    await expect(reconcileExistingRegistrationProjection(client as never, input))
      .resolves.toEqual({
        relationCreated: false, historyCreated: false, placementCreated: false,
      });

    expect(sql.some(text => text.includes("direct_count=("))).toBe(true);
    expect(sql.some(text => text.includes("UPDATE users SET status='ACTIVE'"))).toBe(true);
    expect(sql.some(text => text.includes("UPDATE registrations SET status='CONFIRMED'"))).toBe(true);
    expect(sql.some(text => text.includes("INSERT INTO blockchain_transactions"))).toBe(true);
    expect(sql.join("\n")).not.toMatch(/direct_income_ledger|magic_wallet_ledger|matrix_placements|INSERT INTO users/);
    expect(recordReferralHistory).toHaveBeenCalledTimes(2);
    expect((recordReferralHistory.mock.calls as unknown[][])[0][1]).toMatchObject({
      userWallet: input.sponsor,
      sourceWallet: input.wallet,
      eventType: "DIRECT_REFERRAL_ACTIVATED",
      txHash: input.txHash,
      idempotencyKey: `referral_relations:relation-ab:DIRECT_REFERRAL_ACTIVATED:${input.sponsor}`,
    });
  });

  it("inserts a missing matrix placement once and validates the emitted placement", async () => {
    let placementInserted = false;
    const client = {
      query: vi.fn(async (text: string) => {
        if (text.startsWith("INSERT INTO referral_relations")) {
          return { rows: [{ id: "relation-ab" }] };
        }
        if (text.startsWith("SELECT id,sponsor_user_id")) {
          return { rows: [{
            id: "relation-ab", sponsor_user_id: "user-a", registration_id: "registration-b",
          }] };
        }
        if (text === "SELECT id FROM users WHERE wallet_address=$1") {
          return { rows: [{ id: "matrix-parent" }] };
        }
        if (text.includes("INSERT INTO matrix_placements")) {
          if (placementInserted) return { rows: [] };
          placementInserted = true;
          return { rows: [{ id: "placement-b" }] };
        }
        if (text.includes("FROM matrix_placements WHERE user_id=$1")) {
          return { rows: [{
            parent_user_id: "matrix-parent",
            position: 1,
            bfs_index: "42",
            registration_id: "registration-b",
          }] };
        }
        return { rows: [] };
      }),
    };
    const matrixInput = {
      ...input,
      matrixParent: "0x00000000000000000000000000000000000000cc",
      matrixIndex: 42n,
      matrixPosition: 1,
    };

    await expect(reconcileExistingRegistrationProjection(client as never, matrixInput))
      .resolves.toMatchObject({ placementCreated: true });
    await expect(reconcileExistingRegistrationProjection(client as never, matrixInput))
      .resolves.toMatchObject({ placementCreated: false });
    const sql = client.query.mock.calls.map(([text]) => String(text)).join("\n");
    expect(sql).toContain("ON CONFLICT(user_id) DO NOTHING");
    expect(sql).not.toMatch(/direct_income_ledger|magic_wallet_ledger/);
  });
});
