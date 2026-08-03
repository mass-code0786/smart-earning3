import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const requireSession = vi.fn(), getIncomeHistory = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireSession }));
vi.mock("@/lib/server/income-history-service", () => ({ getIncomeHistory }));

describe("GET /api/income/history authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); getIncomeHistory.mockResolvedValue({ items: [], nextCursor: null }); });

  it("passes only the authenticated session wallet into the history service", async () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    requireSession.mockResolvedValue({ wallet });
    const { GET } = await import("@/app/api/income/history/route");
    const request = new NextRequest("http://localhost/api/income/history?incomeType=DIRECT_INCOME&userId=another-user");
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(getIncomeHistory).toHaveBeenCalledWith(wallet, request.nextUrl.searchParams);
  });

  it("does not access history after authentication failure", async () => {
    requireSession.mockRejectedValue(new Error("unauthorized"));
    const { GET } = await import("@/app/api/income/history/route");
    const response = await GET(new NextRequest("http://localhost/api/income/history?incomeType=BOOSTER"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(getIncomeHistory).not.toHaveBeenCalled();
  });
});
