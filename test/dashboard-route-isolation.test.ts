// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const userDashboard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/auth", () => ({ requireSession }));
vi.mock("@/lib/server/dashboard-service", () => ({ userDashboard }));

describe("GET /api/dashboard session isolation", () => {
  beforeEach(() => {
    requireSession.mockReset();
    userDashboard.mockReset();
  });

  it("uses only the verified session wallet and disables shared caching", async () => {
    const walletA = "0x00000000000000000000000000000000000000aa";
    const walletB = "0x00000000000000000000000000000000000000bb";
    requireSession
      .mockResolvedValueOnce({ wallet: walletA, chainId: 97 })
      .mockResolvedValueOnce({ wallet: walletB, chainId: 97 });
    userDashboard.mockImplementation(async (wallet: string) => ({ wallet_address: wallet }));
    const { GET } = await import("@/app/api/dashboard/route");

    const first = await GET();
    const second = await GET();

    expect(userDashboard.mock.calls).toEqual([[walletA], [walletB]]);
    expect((await first.json()).user.wallet_address).toBe(walletA);
    expect((await second.json()).user.wallet_address).toBe(walletB);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(second.headers.get("cache-control")).toBe("private, no-store");
  });
});
