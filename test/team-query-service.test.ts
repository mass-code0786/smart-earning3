import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/server/db", () => ({ query }));

describe("team query service", () => {
  beforeEach(() => query.mockReset());

  it("returns relational direct members and recursive live totals", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "user-1", wallet_address: "0x1234567890abcdef1234567890abcdef12345678" }] })
      .mockResolvedValueOnce({ rows: [{ total_team: 4, active_members: 3, inactive_members: 1 }] })
      .mockResolvedValueOnce({ rows: [{
        wallet_address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        status: "ACTIVE",
        joined_at: new Date("2026-07-28T10:00:00Z"),
        active_package_value: "8000000",
      }] });

    const { getTeam } = await import("@/lib/server/team-query-service");
    const result = await getTeam("0x1234567890abcdef1234567890abcdef12345678");

    expect(result).toMatchObject({
      referralIdentifier: "0x1234567890abcdef1234567890abcdef12345678",
      directMembers: 1,
      totalTeam: 4,
      activeMembers: 3,
      inactiveMembers: 1,
    });
    expect(String(query.mock.calls[1][0])).toContain("WITH RECURSIVE team");
    expect(String(query.mock.calls[2][0])).toContain("referral_relations");
  });
});
