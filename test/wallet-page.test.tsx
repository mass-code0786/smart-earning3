import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealWallet from "@/components/real-wallet";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Wallet summary page", () => {
  it("renders the removed Home summaries from live API responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const payload = input === "/api/dashboard" ? { user: {
        wallet_address: "0x1234567890abcdef1234567890abcdef12345678",
        direct_count: 2,
        magicBalance: "3000000",
        financial: {
          income_wallet:"1000000",income_reserved:"2000000",total_withdrawn:"3000000",
          hold_wallet:"4000000",booster_wallet:"5000000",dividend_income:"6000000",
          gross_earned:"7000000",cap_used:"8000000",cap_remaining:"9000000",active_package:"16000000",
        },
      }} : input === "/api/booster" ? {
        server_time:"2026-07-28T10:00:00Z",next_entry_at:"2026-07-28T14:59:30Z",
        eligibility:"NOT_DUE",booster_wallet_balance:"5000000",
      } : input === "/api/packages" ? { packages: [
        { packageId:1,name:"1st Package",status:"PURCHASED" },
        { packageId:2,name:"2nd Package",status:"PURCHASED" },
      ] } : { totalTeam: 5 };
      return { ok:true, json:async()=>payload };
    }));

    render(<RealWallet />);
    expect(await screen.findByText("Authenticated Wallet")).toBeInTheDocument();
    for (const label of [
      "Income Wallet","Magic Wallet","X3 Hold Wallet","Booster Wallet","Total Earned",
      "Total Withdrawn","Pending Withdrawal","Dividend Income","5X Cap Used",
      "5X Cap Remaining","Active Package Value","Current Package","Direct Members","Total Team",
    ]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Next booster: 04:59:30")).toBeInTheDocument();
    expect(screen.getByText("2nd Package · #2")).toBeInTheDocument();
  });
});
