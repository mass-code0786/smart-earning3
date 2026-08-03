import { describe, expect, it, vi } from "vitest";
import { reconcileLegacyBoosterInterval } from "@/lib/server/booster-interval-reconciliation";

const legacy = {
  user_id: "10000000-0000-0000-0000-000000000001",
  wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
  last_entry_at: "2026-08-03T08:00:00.000Z",
  next_entry_at: "2026-08-03T13:00:00.000Z",
  corrected_next_entry_at: "2026-08-03T12:00:00.000Z",
};

describe("legacy Booster interval reconciliation", () => {
  it("dry-runs only the exact five-hour signature without writing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [legacy] });
    const result = await reconcileLegacyBoosterInterval(true, { query } as never);
    expect(result).toEqual({
      dryRun: true,
      affectedRows: 1,
      examples: [{
        userId: legacy.user_id,
        wallet: legacy.wallet_address,
        lastEntryAt: legacy.last_entry_at,
        beforeNextEntryAt: legacy.next_entry_at,
        afterNextEntryAt: legacy.corrected_next_entry_at,
      }],
    });
    expect(String(query.mock.calls[0][0])).toContain("m.next_entry_at=m.last_entry_at+interval '5 hours'");
    expect(String(query.mock.calls[0][0])).not.toContain("UPDATE booster_memberships");
  });

  it("applies four hours with an overdue-now floor and is idempotent", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [legacy] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const first = await reconcileLegacyBoosterInterval(false, { query } as never);
    const second = await reconcileLegacyBoosterInterval(false, { query } as never);
    expect(first.affectedRows).toBe(1);
    expect(second.affectedRows).toBe(0);
    const update = String(query.mock.calls[1][0]);
    expect(update).toContain("GREATEST(m.last_entry_at+interval '4 hours',transaction_timestamp())");
    expect(update).toContain("m.next_entry_at=m.last_entry_at+interval '5 hours'");
    expect(update).not.toMatch(/booster_entries\s+SET|booster_scheduler_history\s+SET/i);
  });
});
