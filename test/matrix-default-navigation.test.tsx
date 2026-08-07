import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatrixPage from "@/app/matrix/page";
import MenuPage from "@/components/menu-page";
import { SmartEarningBottomNav } from "@/components/smart-earning-shell";

const navigation = vi.hoisted(() => ({ path: "/matrix", push: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => ({ push: navigation.push }),
  redirect,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.push.mockReset();
  redirect.mockReset();
  navigation.path = "/matrix";
});

describe("Matrix default navigation", () => {
  it("redirects the legacy /matrix bookmark to the Magic Level Report", () => {
    MatrixPage();
    expect(redirect).toHaveBeenCalledWith("/magic-level");
  });

  it("keeps every current matrix module reachable without linking the legacy page", async () => {
    navigation.path = "/menu";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ referralIdentifier: "member-1" }), { status: 200 })));
    render(<MenuPage/>);
    await waitFor(() => expect(screen.getByText("MATRIX")).toBeInTheDocument());
    for (const [name, href] of [
      ["Magic Level Report", "/magic-level"], ["X3 Matrix", "/matrix/x3"], ["X4 Matrix", "/matrix/x4"],
      ["Booster", "/booster"], ["Global Autopool", "/autopool"],
    ]) expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(screen.queryByRole("link", { name: "Magic Level Matrix" })).not.toBeInTheDocument();
  });

  it("uses the required Home, Income, Team, Wallet, Summary order", () => {
    navigation.path = "/magic-level";
    render(<SmartEarningBottomNav/>);
    expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual(["Home", "Income", "Team", "Wallet", "Summary"]);
  });
});
