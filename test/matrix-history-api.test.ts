import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireSession = vi.fn(), getMatrixHistory = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireSession }));
vi.mock("@/lib/server/matrix-history-service", () => ({ getMatrixHistory }));

describe("GET /api/matrix/history authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); getMatrixHistory.mockResolvedValue({ items: [], nextCursor: null }); });

  it("uses only the authenticated session wallet", async () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    requireSession.mockResolvedValue({ wallet });
    const { GET } = await import("@/app/api/matrix/history/route");
    const request = new NextRequest("http://localhost/api/matrix/history?module=X3&packageId=2&userId=another-user");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(getMatrixHistory).toHaveBeenCalledWith(wallet, request.nextUrl.searchParams);
  });

  it("rejects unauthenticated requests before reading history", async () => {
    requireSession.mockRejectedValue(new Error("unauthorized"));
    const { GET } = await import("@/app/api/matrix/history/route");
    const response = await GET(new NextRequest("http://localhost/api/matrix/history?module=X4&packageId=2"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(getMatrixHistory).not.toHaveBeenCalled();
  });
});
