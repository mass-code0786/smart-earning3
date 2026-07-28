import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, walletLoginMock, switchMock } = vi.hoisted(() => ({
  push: vi.fn(), walletLoginMock: vi.fn(), switchMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/client/wallet", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/client/wallet")>(),
  walletLogin: walletLoginMock, switchToTestnet: switchMock,
}));
vi.mock("@/components/registration-form", () => ({
  RegistrationForm: ({ initialSponsor, compact }: { initialSponsor: string; compact?: boolean }) =>
    <div data-compact={compact} data-testid="registration-form">Sponsor: {initialSponsor}</div>,
}));

import {
  LandingActionButtons, LandingInlinePanel, LandingInteractionProvider,
} from "@/components/landing-interactions";

const sponsor = "0x1234567890abcdef1234567890abcdef12345678";
function Subject() {
  return <LandingInteractionProvider initialSponsor={sponsor} registrationEnabled>
    <LandingActionButtons compact/><LandingActionButtons/>
    <LandingInlinePanel initialSponsor={sponsor} registrationEnabled/>
  </LandingInteractionProvider>;
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });

describe("landing inline wallet actions", () => {
  it.each([0, 1])("starts authentication from Connect button %s without navigation", async index => {
    walletLoginMock.mockResolvedValue({ registered: true, wallet: sponsor, chainId: 97 });
    render(<Subject/>);
    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[index]);
    await waitFor(() => expect(walletLoginMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it.each([0, 1])("opens inline Signup from button %s and preserves referral sponsor", index => {
    render(<Subject/>);
    fireEvent.click(screen.getAllByRole("button", { name: "Signup" })[index]);
    expect(screen.getByTestId("registration-form")).toHaveTextContent(sponsor);
    expect(screen.getByTestId("registration-form")).toHaveAttribute("data-compact", "true");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByText("NEW ACCOUNT")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Signup" })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("moves a genuinely unregistered authenticated wallet into inline Signup", async () => {
    walletLoginMock.mockResolvedValue({ registered: false, wallet: sponsor, chainId: 97 });
    render(<Subject/>);
    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);
    expect(await screen.findByTestId("registration-form")).toHaveTextContent(sponsor);
  });

  it("restores inline Signup after refresh without losing the referral sponsor", async () => {
    sessionStorage.setItem("landing-inline-mode", "signup");
    render(<Subject/>);
    expect(await screen.findByTestId("registration-form")).toHaveTextContent(sponsor);
  });

  it("renders wallet errors inline and prevents duplicate pending requests", async () => {
    let reject!: (error: Error) => void;
    walletLoginMock.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<Subject/>);
    const button = screen.getAllByRole("button", { name: "Connect" })[0];
    fireEvent.click(button); fireEvent.click(button);
    expect(walletLoginMock).toHaveBeenCalledOnce();
    reject(new Error("Wallet connection rejected"));
    expect(await screen.findByText("Wallet connection rejected")).toBeInTheDocument();
  });
});
