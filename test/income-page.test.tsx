import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectIncomeLive } from "@/components/live-plan-data";
import IncomePage from "@/app/income/page";

const walletState = vi.hoisted(() => ({ connectedWallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }));
vi.mock("@/lib/client/wallet", () => ({
  getInjectedProvider: () => ({ request: vi.fn(async () => [walletState.connectedWallet]) }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/income",
  useRouter: () => ({ push: vi.fn() }),
}));

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
  it("does not render the automatic withdrawal section", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: { incomeTotals } }), { status: 200 })));
    render(<IncomePage />);
    expect(await screen.findByText("Direct Income")).toBeInTheDocument();
    expect(screen.queryByText("AUTOMATIC WITHDRAWAL")).not.toBeInTheDocument();
    expect(screen.queryByText("Income Wallet payouts")).not.toBeInTheDocument();
    expect(screen.queryByText("No automatic withdrawal records yet.")).not.toBeInTheDocument();
  });

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

  it("opens only the selected card's canonical history and supports an empty state", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/dashboard") return new Response(JSON.stringify({ user: { incomeTotals } }), { status: 200 });
      const incomeType = new URL(url, "http://localhost").searchParams.get("incomeType")!;
      const items = incomeType === "MAGIC_LEVEL_INCOME" ? [] : [{
        id: "10000000-0000-0000-0000-000000000001",
        income_type: incomeType,
        source_reference: `source:${incomeType}`,
        credited_amount: "1000000",
        created_at: "2026-08-03T10:00:00.000Z",
      }];
      return new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DirectIncomeLive />);

    for (const [incomeType, label] of incomeTotals.map(item => [item.incomeType, ({
      DIRECT_INCOME: "Direct Income", MAGIC_LEVEL_INCOME: "Magic Level Income",
      X3_PACKAGE: "Working X3 Package Income", X3_HOLD_RELEASE: "Working X3 Hold Release Income",
      X4_GLOBAL: "Working X4 Global Income", BOOSTER: "Booster Income",
      GLOBAL_AUTOPOOL: "Global Autopool Income", DAILY_DIVIDEND: "Daily Dividend Income",
    } as Record<string, string>)[item.incomeType]])) {
      fireEvent.click(await screen.findByRole("button", { name: `Open ${label} history` }));
      await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
        `/api/income/history?incomeType=${incomeType}&limit=20`,
        expect.objectContaining({ cache: "no-store", credentials: "same-origin", headers: expect.any(Headers) }),
      ));
      const historyCall = fetcher.mock.calls.find(([url]) => String(url).includes(`incomeType=${incomeType}`)) as unknown as [unknown, RequestInit];
      expect(new Headers(historyCall[1].headers).get("x-connected-wallet")).toBe(walletState.connectedWallet);
      const dialog = await screen.findByRole("dialog", { name: `${label} history` });
      expect(dialog).toHaveClass("centered-modal-panel");
      expect(dialog.parentElement?.parentElement).toBe(document.body);
      expect(document.body.style.overflow).toBe("hidden");
      if (incomeType === "MAGIC_LEVEL_INCOME") expect(await screen.findByText("No income history yet")).toBeInTheDocument();
      else expect(await screen.findByText(`source:${incomeType}`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close income history" }));
      expect(document.body.style.overflow).toBe("");
    }
  });

  it("closes Income history from its shared backdrop and Escape", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input) === "/api/dashboard"
      ? new Response(JSON.stringify({ user: { incomeTotals } }), { status: 200 })
      : new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<DirectIncomeLive />);
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Open Direct Income history" }));
    await screen.findByRole("button", { name: "Open Direct Income history" });
    open();
    let dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).not.toBeInTheDocument();
  });
});
