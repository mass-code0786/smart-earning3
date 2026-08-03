import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ query }));
import { getMatrixHistory } from "@/lib/server/matrix-history-service";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";
const userId = "20000000-0000-0000-0000-000000000001";
const entryId = "30000000-0000-0000-0000-000000000001";
const row = (index: number, module = "X4") => ({
  id: `10000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  memberId: `40000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", module,
  level: 2, position: 4, levelPosition: null, childSlot: null, packageId: 3,
  amount: "32000000", transactionHash: `0x${String(index).padStart(64, "0")}`,
  reference: `50000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  placedAt: new Date(Date.UTC(2026, 0, 1, 0, 1, 30 - index)),
});

describe("matrix placement history service", () => {
  beforeEach(() => query.mockReset());

  it.each([
    ["MAGIC_LEVEL", "matrix_placements", "p.parent_user_id=$1", new URLSearchParams({ module: "MAGIC_LEVEL" }), [userId, null, null, 21]],
    ["X3", "x3_cycle_slots", "c.user_id=$1 AND c.package_id=$2", new URLSearchParams({ module: "X3", packageId: "3" }), [userId, 3, null, null, 21]],
    ["X4", "x4_positions", "c.user_id=$1 AND c.package_id=$2", new URLSearchParams({ module: "X4", packageId: "3" }), [userId, 3, null, null, 21]],
    ["BOOSTER", "booster_positions", "e.owner_user_id=$1 AND e.id=$2", new URLSearchParams({ module: "BOOSTER", entryId }), [userId, entryId, null, null, 21]],
    ["AUTOPOOL", "autopool_positions", "e.owner_user_id=$1 AND e.id=$2", new URLSearchParams({ module: "AUTOPOOL", entryId }), [userId, entryId, null, null, 21]],
  ])("isolates %s records to the authenticated owner's canonical projection", async (_module, table, ownership, parameters, values) => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: [row(1, String(_module))] });
    const result = await getMatrixHistory(wallet, parameters);
    expect(query.mock.calls[0][1]).toEqual([wallet]);
    expect(String(query.mock.calls[1][0])).toContain(String(table));
    expect(String(query.mock.calls[1][0])).toContain(String(ownership));
    expect(String(query.mock.calls[1][0])).toContain("ORDER BY");
    expect(String(query.mock.calls[1][0])).toContain("DESC");
    expect(query.mock.calls[1][1]).toEqual(values);
    expect(result.items[0]).toMatchObject({ memberId: row(1).memberId, level: 2, position: 4 });
  });

  it("paginates without duplicate or missing rows using timestamp plus UUID", async () => {
    const firstRows = Array.from({ length: 21 }, (_, index) => row(index));
    const secondRows = Array.from({ length: 5 }, (_, index) => row(index + 20));
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: firstRows });
    const first = await getMatrixHistory(wallet, new URLSearchParams({ module: "X4", packageId: "3" }));
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: secondRows });
    const second = await getMatrixHistory(wallet, new URLSearchParams({ module: "X4", packageId: "3", cursor: first.nextCursor! }));
    expect(first.items).toHaveLength(20);
    expect(query.mock.calls[3][1][2]).toBe(first.items[19].placedAt.toISOString());
    expect(query.mock.calls[3][1][3]).toBe(first.items[19].id);
    const combined = [...first.items, ...second.items];
    expect(new Set(combined.map(item => item.id)).size).toBe(combined.length);
    expect(combined.map(item => item.id)).toEqual(Array.from({ length: 25 }, (_, index) => row(index).id));
  });

  it("rejects malformed cursors before database access", async () => {
    await expect(getMatrixHistory(wallet, new URLSearchParams({ module: "MAGIC_LEVEL", cursor: "not-a-cursor" }))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects unowned entry identifiers through the owner-scoped query", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: userId }] }).mockResolvedValueOnce({ rows: [] });
    const result = await getMatrixHistory(wallet, new URLSearchParams({ module: "BOOSTER", entryId }));
    expect(result.items).toEqual([]);
    expect(String(query.mock.calls[1][0])).toContain("e.owner_user_id=$1 AND e.id=$2");
  });
});
