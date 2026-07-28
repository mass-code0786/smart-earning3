import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MenuPage, { logoutFromMenu } from "@/components/menu-page";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";

describe("mobile Menu page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ referralIdentifier: wallet }),
    })));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: vi.fn(async () => undefined) },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the grouped live navigation routes", async () => {
    render(<MenuPage />);
    await screen.findByText(new RegExp(wallet, "i"));
    const routes: [string, string][] = [
      ["Booster Wallet Topup", "/booster"],
      ["Booster Activation Wallet History", "/history?category=BOOSTER"],
      ["X3 Booster Structure", "/matrix/x3"],
      ["Buy Package", "/packages"],
      ["Upgrade Package", "/packages"],
      ["Transaction List", "/history?category=PACKAGES"],
      ["Account Summary", "/wallet"],
      ["Withdraw History", "/history?category=WITHDRAWALS"],
      ["Direct Income", "/history?category=DIRECT_INCOME"],
      ["Magic Level Income", "/history?category=MAGIC_LEVEL"],
      ["Working X3 Matrix Income", "/history?category=X3"],
      ["Non Working X4 Matrix Income", "/history?category=X4"],
      ["X3 Booster Income", "/history?category=BOOSTER_INCOME"],
      ["Global Auto Pool Income", "/history?category=AUTOPOOL"],
      ["Daily Dividend Income", "/history?category=DIVIDEND"],
      ["Magic Wallet Report", "/wallet?section=magic"],
      ["Magic Level Report", "/history?category=MAGIC_LEVEL"],
      ["Hold Wallet Report", "/wallet?section=hold"],
      ["Direct Affiliate", "/team?view=direct"],
      ["Team Affiliate", "/team?view=all"],
    ];
    for (const [label, href] of routes) expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    expect(screen.queryByText("Support")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
  });

  it("copies the authenticated user's production-origin referral link", async () => {
    render(<MenuPage />);
    await screen.findByText(new RegExp(wallet, "i"));
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    const expected = `${window.location.origin}/register?ref=${wallet}`;
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("status")).toHaveTextContent("Invite link copied");
  });

  it("requires confirmation before secure logout", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MenuPage />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
  });

  it("uses the existing secure logout endpoint after confirmation", async () => {
    const redirect = vi.fn();
    expect(await logoutFromMenu(() => true, redirect)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
