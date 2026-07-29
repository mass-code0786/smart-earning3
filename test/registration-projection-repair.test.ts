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
      .resolves.toEqual({ relationCreated: true, historyCreated: true });
    await expect(reconcileExistingRegistrationProjection(client as never, input))
      .resolves.toEqual({ relationCreated: false, historyCreated: false });

    expect(sql.some(text => text.includes("direct_count=("))).toBe(true);
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
});
