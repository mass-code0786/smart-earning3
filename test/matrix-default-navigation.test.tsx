import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatrixPage from "@/app/matrix/page";
import MenuPage from "@/components/menu-page";
import { SmartEarningBottomNav } from "@/components/smart-earning-shell";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const navigation = vi.hoisted(() => ({ path: "/matrix", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/components/page-sections", () => ({ CompactPageTitle: ({ title }: { title: string }) => <section data-testid="compact-title"><h1>{title}</h1></section> }));
vi.mock("@/lib/client/authenticated-fetch", () => ({
  authenticatedWalletFetch: vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/structure") ? { levels: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: 0 })) } : { items: [], nextCursor: null },
  ), { status: 200 })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); navigation.push.mockReset(); navigation.path = "/matrix"; });

describe("Matrix default navigation", () => {
  it("renders Magic Level directly at /matrix while keeping Matrix out of bottom navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: {
      direct_count: 0, magicBalance: "0", magicIncomeHistory: [], incomeTotals: [],
    } }), { status: 200 })));
    render(<MatrixPage/>);
    expect(await screen.findByText("MAGIC LEVEL MATRIX")).toBeInTheDocument();
    expect(screen.getByTestId("compact-title")).toHaveTextContent("Magic Level");
    expect(screen.queryByText("BNB Testnet")).not.toBeInTheDocument();
    expect(screen.queryByText("20 levels with permanent 1 × 2 BFS spillover placement and verified daily USDT distribution records.")).not.toBeInTheDocument();
    expect(screen.queryByText("Magic Wallet Balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily Required Balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Distribution Status")).not.toBeInTheDocument();
    expect(screen.getByText("Level 1 to Level 20")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View More" })).toHaveLength(20);
    expect(screen.queryByText("VERIFIED MATRIX RECORDS")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a matrix backed by an available server endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Matrix" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(navigation.push).toHaveBeenCalledWith("/menu");
    expect(readFileSync(resolve("components/page-sections.tsx"), "utf8")).toContain('className="px-4 py-3 sm:px-5 sm:py-4"');
  });

  it("keeps every existing matrix module reachable from the hamburger menu", async () => {
    navigation.path = "/menu";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ referralIdentifier: "member-1" }), { status: 200 })));
    render(<MenuPage/>);
    await waitFor(() => expect(screen.getByText("MATRIX")).toBeInTheDocument());
    for (const [name, href] of [
      ["Magic Level Matrix", "/matrix"], ["X3 Matrix", "/matrix/x3"], ["X4 Matrix", "/matrix/x4"],
      ["Booster", "/booster"], ["Global Autopool", "/autopool"],
    ]) expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });

  it("uses the required Home, Income, Team, Wallet, Summary order", () => {
    navigation.path = "/magic-level";
    render(<SmartEarningBottomNav/>);
    expect(screen.getAllByRole("link").map(link=>link.textContent)).toEqual(["Home","Income","Team","Wallet","Summary"]);
  });
});
