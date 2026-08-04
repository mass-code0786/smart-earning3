import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealWallet from "@/components/real-wallet";
import { formatX3HoldRemaining, X3HoldCountdown } from "@/components/real-wallet";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    x3Hold:{earliestExpiresAt:null},serverTime:"2026-07-28T10:00:00Z",
    team:{totalTeam:0},
  };
}

describe("Wallet summary page", () => {
  it("formats the display-only X3 Hold countdown as HH:MM:SS",()=>{
    expect(formatX3HoldRemaining(37*3_600_000+24*60_000+18_000)).toBe("37:24:18");
    expect(formatX3HoldRemaining(-1)).toBe("00:00:00");
  });

  it("refreshes at zero and switches to the next backend-provided earliest hold",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-08-04T00:00:00Z"));
    const refresh=vi.fn(async()=>undefined);
    const view=render(<X3HoldCountdown serverTime="2026-08-04T00:00:00Z" expiresAt="2026-08-04T00:00:01Z" onRefresh={refresh}/>);
    expect(screen.getByText("Expires in 00:00:01")).toBeInTheDocument();
    await act(async()=>vi.advanceTimersByTime(1000));
    expect(screen.getByText("Expires in 00:00:00")).toBeInTheDocument();expect(refresh).toHaveBeenCalledOnce();
    view.rerender(<X3HoldCountdown serverTime="2026-08-04T00:00:01Z" expiresAt="2026-08-05T07:45:01Z" onRefresh={refresh}/>);
    expect(screen.getByText("Expires in 31:45:00")).toBeInTheDocument();
  });

  it("shows no fake countdown for zero or grandfathered-only holds",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(snapshot(walletA)),{status:200,headers:{"content-type":"application/json"}})));
    render(<RealWallet/>);await screen.findByText("X3 Hold Wallet");
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
  });
  it("keeps the due-booster refresh mounted instead of creating a fetch loop", async () => {
    const dueSnapshot = snapshot(walletA);
    const dueBooster = dueSnapshot.booster as {
      server_time: string; next_entry_at: string | null;
      eligibility: string; booster_wallet_balance: string;
    };
    dueBooster.next_entry_at = "2026-07-28T10:00:00Z";
    dueBooster.eligibility = "DUE";
    const fetcher = vi.fn(async () => new Response(JSON.stringify(dueSnapshot), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);

    const view = render(<RealWallet />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(2);
    view.unmount();
  });

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
