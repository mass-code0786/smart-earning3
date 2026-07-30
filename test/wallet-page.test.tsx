import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealWallet from "@/components/real-wallet";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const walletA = "0x1234567890abcdef1234567890abcdef12345678";
const walletB = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function snapshot(wallet: string, amount = "0") {
  return {
    authenticatedWallet: wallet,
    user: {
      wallet_address: wallet,
      direct_count: 0,
      magicBalance: amount,
      financial: {
        income_wallet:amount,income_reserved:"0",total_withdrawn:"0",
        hold_wallet:"0",booster_wallet:"0",dividend_income:"0",
        gross_earned:amount,cap_used:"0",cap_remaining:"0",active_package:"0",
      },
    },
    booster: {
      server_time:"2026-07-28T10:00:00Z",next_entry_at:null,
      eligibility:"INACTIVE",booster_wallet_balance:"0",
    },
    currentPackage:null,
    team:{totalTeam:0},
  };
}

describe("Wallet summary page", () => {
  it("renders a single session-owned wallet snapshot with zero-safe values", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot(walletB)), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<RealWallet />);
    expect(await screen.findByText("Authenticated Wallet")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/wallet", expect.objectContaining({
      cache: "no-store", credentials: "same-origin",
    }));
    expect(screen.getAllByText("$0.00 USDT").length).toBeGreaterThanOrEqual(8);
    for (const label of [
      "Income Wallet","Magic Wallet","X3 Hold Wallet","Booster Wallet","Total Earned",
      "Total Withdrawn","Pending Withdrawal","Dividend Income","5X Cap Used",
      "5X Cap Remaining","Active Package Value","Current Package","Direct Members","Total Team",
    ]) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("rejects a mismatched authenticated-wallet payload instead of showing stale values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...snapshot(walletA, "900000"),
      authenticatedWallet: walletB,
    }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<RealWallet />);
    expect(await screen.findByText("Wallet data could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("$0.90 USDT")).not.toBeInTheDocument();
  });

  it("refetches a clean snapshot after unmount/login with another wallet", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot(walletA, "900000")), {
        status: 200, headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot(walletB)), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetcher);
    const first = render(<RealWallet />);
    expect((await screen.findAllByText("$0.90 USDT")).length).toBeGreaterThan(0);
    first.unmount();
    render(<RealWallet />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("$0.90 USDT")).not.toBeInTheDocument();
    expect(screen.getAllByText("$0.00 USDT").length).toBeGreaterThanOrEqual(8);
  });
});
