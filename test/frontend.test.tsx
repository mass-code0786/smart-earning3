import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MagicPlanLive } from "@/components/live-plan-data";

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
    expect(screen.getAllByText("2 / 10 directs")).toHaveLength(2);
  });
});
