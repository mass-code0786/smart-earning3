import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MagicPlanLive } from "@/components/live-plan-data";

vi.mock("@/lib/client/authenticated-fetch", () => ({
  authenticatedWalletFetch: vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/structure") ? { levels: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: 0 })) } : { items: [], nextCursor: null },
  ), { status: 200 })),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Magic Level frontend", () => {
  it("shows 20 levels and the real insufficient-balance state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: {
        wallet_address: "0x0000000000000000000000000000000000000001",
        direct_count: 2, sponsor_wallet: null, tx_hash: null, registration_status: "CONFIRMED",
        magicBalance: "500000", directIncomeTotal: "0", directIncomeToday: "0",
        directIncomeHistory: [], magicIncomeHistory: [],
      } }),
    }));
    render(<MagicPlanLive />);
    await waitFor(() => expect(screen.getByText("INSUFFICIENT MAGIC BALANCE")).toBeInTheDocument());
    expect(screen.getByText("Level 20")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View More" })).toHaveLength(20);
    expect(screen.getAllByText("0 Users")).toHaveLength(20);
  });
});
