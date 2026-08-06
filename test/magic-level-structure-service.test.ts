import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/db", () => ({ query }));
import { getMagicLevelStructure, getMagicLevelUsers } from "@/lib/server/magic-level-structure-service";
import { smartEarningDeployment } from "@/lib/blockchain/deployment-metadata";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";
const ownerId = "20000000-0000-0000-0000-000000000001";
const row = (index: number) => ({
  id: `10000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  memberId: `30000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", level: 2, position: index % 2,
  registrationId: `40000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  transactionHash: `0x${String(index).padStart(64, "0")}`,
  placedAt: new Date(Date.UTC(2026, 0, 1, 0, 1, 30 - index)),
});

describe("Magic Level structure service", () => {
  beforeEach(() => query.mockReset());

  it("returns exactly 20 owner-relative levels including zero counts", async () => {
    const levels = Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: index < 3 ? [2, 4, 8][index] : 0 }));
    query.mockResolvedValueOnce({ rows: [{ id: ownerId }] }).mockResolvedValueOnce({ rows: levels });
    const result = await getMagicLevelStructure(wallet);
    expect(result.levels).toEqual(levels);
    const sql = String(query.mock.calls[1][0]);
    expect(query.mock.calls[1][1]).toEqual([ownerId, smartEarningDeployment().address]);
    expect(sql).toContain("p.parent_user_id=$1");
    expect(sql).toContain("p.contract_address=$2");
    expect(sql).toContain("child.contract_address=parent.contract_address");
    expect(sql).toContain("parent.relative_level+1");
    expect(sql).toContain("parent.relative_level<20");
    expect(sql).toContain("NOT child.user_id=ANY(parent.traversal_path)");
    expect(sql).toContain("count(DISTINCT user_id)");
    expect(sql).toContain("generate_series(1,20)");
    expect(sql).toContain("(p.position+1)::int visible_position");
    expect(sql).toContain("parent.visible_position*2+child.position+1");
  });

  it("returns only the selected relative level and uses stable keyset pagination", async () => {
    const firstRows = Array.from({ length: 21 }, (_, index) => row(index));
    query.mockResolvedValueOnce({ rows: [{ id: ownerId }] }).mockResolvedValueOnce({ rows: firstRows });
    const first = await getMagicLevelUsers(wallet, new URLSearchParams({ level: "2" }));
    expect(first.items).toHaveLength(20);
    expect(String(query.mock.calls[1][0])).toContain("p.relative_level=$3");
    expect(query.mock.calls[1][1]).toEqual([ownerId, smartEarningDeployment().address, 2, null, null, 21]);
    query.mockResolvedValueOnce({ rows: [{ id: ownerId }] }).mockResolvedValueOnce({ rows: [row(20)] });
    await getMagicLevelUsers(wallet, new URLSearchParams({ level: "2", cursor: first.nextCursor! }));
    expect(query.mock.calls[3][1]).toEqual([
      ownerId, smartEarningDeployment().address, 2,
      first.items[19].placedAt.toISOString(), first.items[19].id, 21,
    ]);
  });

  it("derives owner-relative binary-tree positions for the first three levels", () => {
    const children = (parents: number[]) => parents.flatMap(parent => [parent * 2 + 1, parent * 2 + 2]);
    const level1 = [0 + 1, 1 + 1];
    const level2 = children(level1);
    const level3 = children(level2);
    expect(level1).toEqual([1, 2]);
    expect(level2).toEqual([3, 4, 5, 6]);
    expect(level3).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it.each(["0", "21", "text", "1.5"])("rejects invalid level %s before database access", async level => {
    await expect(getMagicLevelUsers(wallet, new URLSearchParams({ level }))).rejects.toMatchObject({ code: "INVALID_LEVEL" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors before database access", async () => {
    await expect(getMagicLevelUsers(wallet, new URLSearchParams({ level: "1", cursor: "bad" }))).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(query).not.toHaveBeenCalled();
  });
});
