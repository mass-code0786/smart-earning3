import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireSession = vi.fn(), getMagicLevelStructure = vi.fn(), getMagicLevelUsers = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireSession }));
vi.mock("@/lib/server/magic-level-structure-service", () => ({ getMagicLevelStructure, getMagicLevelUsers }));

describe("Magic Level structure API ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); getMagicLevelStructure.mockResolvedValue({ levels: [] }); getMagicLevelUsers.mockResolvedValue({ items: [], nextCursor: null }); });

  it("resolves both queries only from the authenticated session wallet", async () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    requireSession.mockResolvedValue({ wallet });
    const structure = await import("@/app/api/matrix/magic-level/structure/route");
    const users = await import("@/app/api/matrix/magic-level/users/route");
    expect((await structure.GET()).status).toBe(200);
    const request = new NextRequest("http://localhost/api/matrix/magic-level/users?level=1&rootUserId=another-user");
    expect((await users.GET(request)).status).toBe(200);
    expect(getMagicLevelStructure).toHaveBeenCalledWith(wallet);
    expect(getMagicLevelUsers).toHaveBeenCalledWith(wallet, request.nextUrl.searchParams);
  });

  it("rejects an invalid or mismatched session before querying placements", async () => {
    requireSession.mockRejectedValue(new Error("Wallet session mismatch"));
    const structure = await import("@/app/api/matrix/magic-level/structure/route");
    const users = await import("@/app/api/matrix/magic-level/users/route");
    expect((await structure.GET()).status).toBeGreaterThanOrEqual(400);
    expect((await users.GET(new NextRequest("http://localhost/api/matrix/magic-level/users?level=1"))).status).toBeGreaterThanOrEqual(400);
    expect(getMagicLevelStructure).not.toHaveBeenCalled(); expect(getMagicLevelUsers).not.toHaveBeenCalled();
  });
});
