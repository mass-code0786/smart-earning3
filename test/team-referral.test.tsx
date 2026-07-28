import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RealTeam from "@/components/real-team";
import { RegistrationForm } from "@/components/registration-form";
import { referralSponsorFromParam } from "@/lib/referral";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const wallet = "0x1234567890abcdef1234567890abcdef12345678";

describe("Team referral experience", () => {
  const writeText = vi.fn();
  const share = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        referralIdentifier: wallet,
        directMembers: 1,
        totalTeam: 3,
        activeMembers: 2,
        inactiveMembers: 1,
        directs: [{
          wallet_address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          status: "ACTIVE",
          joined_at: "2026-07-28T10:00:00.000Z",
          active_package_value: "8000000",
        }],
      }),
    }));
  });
  afterEach(() => cleanup());

  it("builds the authenticated wallet referral link and renders live team data", async () => {
    render(<RealTeam />);
    const link = await screen.findByText(`${window.location.origin}/register?ref=${wallet}`);
    expect(link).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0xabcd…abcd")).toBeInTheDocument();
    expect(screen.getByText(/\$8\.00 USDT/)).toBeInTheDocument();
  });

  it("copies and shares the exact referral link", async () => {
    render(<RealTeam />);
    await screen.findByText(`${window.location.origin}/register?ref=${wallet}`);
    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/register?ref=${wallet}`));
    expect(await screen.findByText("Referral link copied")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
      url: `${window.location.origin}/register?ref=${wallet}`,
      text: expect.stringContaining(`${window.location.origin}/register?ref=${wallet}`),
    })));
  });

  it("prefills a valid referral sponsor and rejects malformed URL values", () => {
    render(<RegistrationForm registrationEnabled initialSponsor={referralSponsorFromParam(wallet)} />);
    expect(screen.getByLabelText("Sponsor wallet")).toHaveValue(wallet);
    expect(referralSponsorFromParam("javascript:alert(1)")).toBe("");
    expect(referralSponsorFromParam("0x1234")).toBe("");
  });
});
