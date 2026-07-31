import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push }),
}));
vi.mock("@/lib/client/wallet", () => ({
  getInjectedProvider: () => ({
    request: async () => ["0x000000000000000000000000000000000000dead"],
  }),
}));

import RealDashboard from "@/components/real-dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("locked mobile Home composition", () => {
  it("does not restart due-booster refresh after every dashboard render", async () => {
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      json: async () => input === "/api/dashboard"
        ? { user: { wallet_address: "0x000000000000000000000000000000000000dead", direct_count: 0 } }
        : input === "/api/booster"
          ? { server_time: "2026-07-28T10:00:00.000Z", next_entry_at: null, eligibility: "DUE" }
          : { packages: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<RealDashboard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("renders only the approved live Home sections in their required order", async () => {
    const prices = [8, 16, 32, 64, 128, 256, 512, 1024];
    const fetchMock = vi.fn(async (input: string) => {
      const body = input === "/api/dashboard"
        ? { user: {
          wallet_address: "0x000000000000000000000000000000000000dEaD",
          direct_count: 4,
        } }
        : input === "/api/x3/packages"
          ? { packages: prices.map((price, index) => ({
            packageId: index + 1,
            priceTokenUnits: String(price * 1_000_000),
            active: index < 2,
            earnedIncome: index === 0 ? "1250000" : "0",
            slots: index === 0 ? [{ slotNumber: 1, wallet: "0x0000000000000000000000000000000000000001" }] : [],
          })) }
          : input === "/api/x4/packages" ? { packages: prices.map((price, index) => ({
            packageId: index + 1,
            priceTokenUnits: String(price * 1_000_000),
            active: index === 0,
            totalEarnings: index === 0 ? "2750000" : "0",
            slots: index === 0 ? [
              { slotNumber: 1, level: 1, wallet: "0x0000000000000000000000000000000000000001" },
              { slotNumber: 2, level: 1, wallet: "0x0000000000000000000000000000000000000002" },
            ] : [],
          })) } : {
            server_time: "2026-07-28T10:00:00.000Z",
            next_entry_at: "2026-07-28T15:00:00.000Z",
            eligibility: "NOT_DUE",
          };
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<RealDashboard />);
    expect(await screen.findByText("Direct Members")).toBeInTheDocument();
    expect(screen.getByText("Total Team")).toBeInTheDocument();
    expect(screen.getByText("0x0000…dEaD")).toBeInTheDocument();

    for (const action of ["Buy Package", "Upgrade Package", "Booster Topup", "Invite"]) {
      expect(screen.getByRole("link", { name: action })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Buy Package" })).toHaveAttribute("href", "/packages");
    expect(screen.getByRole("link", { name: "Booster Topup" })).toHaveAttribute("href", "/booster");
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute("href", "/team");

    const matrixCards = container.querySelectorAll(".home-matrix-card");
    expect(matrixCards).toHaveLength(2);
    expect(within(matrixCards[0] as HTMLElement).getByText("X3")).toBeInTheDocument();
    expect(within(matrixCards[0] as HTMLElement).getByText(/\$1\.25/)).toBeInTheDocument();
    expect(within(matrixCards[1] as HTMLElement).getByText("X4")).toBeInTheDocument();
    expect(within(matrixCards[1] as HTMLElement).getByText(/\$2\.75/)).toBeInTheDocument();
    expect(matrixCards[0].querySelectorAll(".home-matrix-packages>div")).toHaveLength(8);
    expect(matrixCards[1].querySelectorAll(".home-matrix-packages>div")).toHaveLength(8);
    expect(matrixCards[0].querySelectorAll(".is-active")).toHaveLength(2);
    expect(matrixCards[1].querySelectorAll(".is-active")).toHaveLength(1);
    expect(container.querySelector(".home-matrix-tree")).not.toBeInTheDocument();

    const order = [
      container.querySelector(".home-team-summary"),
      container.querySelector(".home-hero-composition"),
      container.querySelector(".home-matrix-list"),
    ];
    expect(order.every(Boolean)).toBe(true);
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const removed of [
      "Authenticated Wallet", "Income Wallet", "Magic Wallet", "X3 Hold Wallet",
      "Total Earned", "Total Withdrawn", "Pending Withdrawal", "Dividend Income",
      "5X Cap Used", "5X Cap Remaining", "Active Package Value",
    ]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }
    expect(screen.getByText("Next booster: 05:00:00")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it("keeps the approved header and bottom navigation labels", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      json: async () => input === "/api/dashboard"
        ? { user: { wallet_address: "0x000000000000000000000000000000000000dead", direct_count: 0 } }
        : input === "/api/booster"
          ? { server_time: "2026-07-28T10:00:00.000Z", next_entry_at: null, eligibility: "INACTIVE" }
          : { packages: [] },
    })));
    render(<RealDashboard />);
    await screen.findByText("Direct Members");
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    for (const label of ["Home", "Income", "Matrix", "Team", "Wallet"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(push).toHaveBeenCalledWith("/menu");
  });

  it("renders the Home composition when optional modules fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dashboard") return {
        ok: true, status: 200,
        json: async () => ({ user: {
          wallet_address: "0x000000000000000000000000000000000000dead",
          direct_count: 0,
        } }),
      };
      return {
        ok: false, status: 503,
        json: async () => ({ error: "Optional module unavailable" }),
      };
    }));
    const { container } = render(<RealDashboard />);
    expect(await screen.findByText("Direct Members")).toBeInTheDocument();
    expect(screen.queryByText("Home data could not be loaded")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".home-matrix-packages>div")).toHaveLength(16);
    expect(container.querySelectorAll(".home-matrix-packages .is-locked")).toHaveLength(16);
    expect(screen.getByText("Booster inactive")).toBeInTheDocument();
    expect(screen.getByText("X3 data temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText("X4 data temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText("Booster data temporarily unavailable")).toBeInTheDocument();
  });
});
