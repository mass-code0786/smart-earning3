// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const getWalletSummary = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auth", () => ({ requireSession }));
vi.mock("@/lib/server/wallet-summary-service", () => ({ getWalletSummary }));

describe("GET /api/wallet", () => {
  it("uses only the verified session wallet and returns private no-store", async () => {
    const wallet = "0x00000000000000000000000000000000000000bb";
    requireSession.mockResolvedValue({ wallet, chainId: 97 });
    getWalletSummary.mockResolvedValue({ authenticatedWallet: wallet });
    const { GET } = await import("@/app/api/wallet/route");
    const response = await GET();
    expect(getWalletSummary).toHaveBeenCalledWith(wallet);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
