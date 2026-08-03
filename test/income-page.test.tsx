import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectIncomeLive } from "@/components/live-plan-data";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const incomeTotals = [
  ["DIRECT_INCOME", "1250000"],
  ["MAGIC_LEVEL_INCOME", "0"],
  ["X3_PACKAGE", "2000000"],
  ["X3_HOLD_RELEASE", "0"],
  ["X4_GLOBAL", "3000000"],
  ["BOOSTER", "0"],
  ["GLOBAL_AUTOPOOL", "100000"],
  ["DAILY_DIVIDEND", "80000"],
].map(([incomeType, total]) => ({ incomeType, total }));

describe("Income totals page", () => {
  it("renders every canonical income type from the authenticated API, including zero totals", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ user: { incomeTotals } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<DirectIncomeLive />);

    for (const label of [
      "Direct Income", "Magic Level Income", "Working X3 Package Income",
      "Working X3 Hold Release Income", "Working X4 Global Income", "Booster Income",
      "Global Autopool Income", "Daily Dividend Income",
    ]) expect(await screen.findByText(label)).toBeInTheDocument();

    expect(screen.getAllByText("$0.00 USDT")).toHaveLength(3);
    expect(screen.getByText("$1.25 USDT")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith("/api/dashboard", expect.objectContaining({ cache: "no-store" }));
    expect(screen.queryByText("Verified Income History")).not.toBeInTheDocument();
  });
});
