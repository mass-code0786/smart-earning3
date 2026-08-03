import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatrixPage from "@/app/matrix/page";
import MenuPage from "@/components/menu-page";
import { SmartEarningBottomNav } from "@/components/smart-earning-shell";

const navigation = vi.hoisted(() => ({ path: "/matrix", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/components/page-sections", () => ({ PageHero: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/lib/client/authenticated-fetch", () => ({
  authenticatedWalletFetch: vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/structure") ? { levels: Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: 0 })) } : { items: [], nextCursor: null },
  ), { status: 200 })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); navigation.push.mockReset(); navigation.path = "/matrix"; });

describe("Matrix default navigation", () => {
  it("renders Magic Level directly at /matrix and keeps the Matrix tab active", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: {
      direct_count: 0, magicBalance: "0", magicIncomeHistory: [], incomeTotals: [],
    } }), { status: 200 })));
    render(<MatrixPage/>);
    expect(await screen.findByText("MAGIC LEVEL MATRIX")).toBeInTheDocument();
    expect(screen.getByText("Level 1 to Level 20")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View More" })).toHaveLength(20);
    expect(screen.queryByText("VERIFIED MATRIX RECORDS")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a matrix backed by an available server endpoint.")).not.toBeInTheDocument();
    const matrixTab = screen.getAllByRole("link", { name: "Matrix" }).find(link => link.className.includes("min-w-[58px]"))!;
    expect(matrixTab).toHaveAttribute("href", "/matrix");
    expect(matrixTab.className).toContain("text-[#F5FFF9]");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(navigation.push).toHaveBeenCalledWith("/menu");
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

  it("keeps the Matrix tab active on the legacy Magic Level URL", () => {
    navigation.path = "/magic-level";
    render(<SmartEarningBottomNav/>);
    expect(screen.getByRole("link", { name: "Matrix" }).className).toContain("text-[#F5FFF9]");
  });
});
