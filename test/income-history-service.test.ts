import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ query }));
import { getIncomeHistory } from "@/lib/server/income-history-service";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";
const userId = "20000000-0000-0000-0000-000000000001";
const row = (index: number) => ({
  id: `10000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  income_type: "BOOSTER",
  source_reference: `booster:${index}`,
  credited_amount: "2000000",
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 30 - index)),
});

describe("canonical income history", () => {
  beforeEach(() => query.mockReset());

  it("scopes the exact income type to the authenticated wallet's user id", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: [row(1)] });
    const result = await getIncomeHistory(wallet, new URLSearchParams({ incomeType: "BOOSTER" }));
    expect(result.items).toHaveLength(1);
    expect(query.mock.calls[0][1]).toEqual([wallet]);
    expect(query.mock.calls[1][1]).toEqual([userId, "BOOSTER", null, null, 21]);
    expect(String(query.mock.calls[1][0])).toContain("WHERE user_id=$1 AND income_type=$2");
  });

  it("uses newest-first keyset pagination with a capped page size", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: Array.from({ length: 21 }, (_, index) => row(index)) });
    const first = await getIncomeHistory(wallet, new URLSearchParams({ incomeType: "BOOSTER", limit: "20" }));
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: [] });
    await getIncomeHistory(wallet, new URLSearchParams({ incomeType: "BOOSTER", cursor: first.nextCursor! }));
    expect(query.mock.calls[3][1][2]).toBeTruthy();
    expect(query.mock.calls[3][1][3]).toBe(first.items[19].id);
    expect(String(query.mock.calls[3][0])).toContain("ORDER BY created_at DESC,id DESC");
  });

  it("rejects non-canonical income types before any database access", async () => {
    await expect(getIncomeHistory(wallet, new URLSearchParams({ incomeType: "OTHER_USER_INCOME" }))).rejects.toMatchObject({ code: "INVALID_INCOME_TYPE" });
    expect(query).not.toHaveBeenCalled();
  });
});
