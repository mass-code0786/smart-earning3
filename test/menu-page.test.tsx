import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MenuPage, { logoutFromMenu } from "@/components/menu-page";

const wallet = "0x1234567890abcdef1234567890abcdef12345678";

describe("mobile Menu page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("/api/auth/session")
        ? { isAdmin: false }
        : { referralIdentifier: wallet },
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
      ["Magic Level Report", "/magic-level"],
      ["Booster Wallet Topup", "/booster"],
      ["Booster History", "/history?category=BOOSTER"],
      ["Buy Package", "/packages"],
      ["Upgrade Package", "/packages"],
      ["Package History", "/history?category=PACKAGE"],
      ["Withdraw History", "/history?category=WITHDRAWAL"],
      ["Direct Income History", "/history?category=DIRECT_INCOME"],
      ["Magic Level Income History", "/history?category=MAGIC_LEVEL_INCOME"],
      ["Working X3 Income History", "/history?category=X3_INCOME"],
      ["X3 Recycle History", "/history?category=X3_RECYCLE"],
      ["Booster Income History", "/history?category=BOOSTER_INCOME"],
      ["Global Autopool Income History", "/history?category=AUTOPOOL"],
      ["Daily Dividend Income History", "/history?category=DIVIDEND"],
      ["Direct Team", "/team#direct-team"],
      ["Total Team", "/team#total-team"],
      ["Wallet Ledger / Wallet History", "/history?category=WALLET"],
      ["Support", "/support"],
    ];
    for (const [label, href] of routes) expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    for (const removed of ["Account Summary", "Transaction List", "Non Working X4 Matrix Income", "Magic Wallet Report", "Magic Level Matrix", "Hold Wallet Report", "Direct Affiliate", "Team Affiliate"])
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
  });

  it("copies the authenticated user's production-origin referral link", async () => {
    render(<MenuPage />);
    await screen.findByText(new RegExp(wallet, "i"));
    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    const expected = `${window.location.origin}/?ref=${wallet}`;
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("status")).toHaveTextContent("Invite link copied");
  });

  it("shows Admin Panel only when the server session marks the wallet as admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes("/api/auth/session")
        ? { isAdmin: true }
        : { referralIdentifier: wallet },
    })));
    render(<MenuPage />);
    expect(await screen.findByRole("link", { name: "Admin Panel" })).toHaveAttribute("href", "/admin");
  });

  it("requires confirmation before secure logout", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MenuPage />);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
  });

  it("uses the existing secure logout endpoint after confirmation", async () => {
    const redirect = vi.fn();
    expect(await logoutFromMenu(() => true, redirect)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
    });
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
