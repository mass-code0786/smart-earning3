import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { replace, refresh, walletLogin, registerOnTestnet, authenticatedWalletSession } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  walletLogin: vi.fn(),
  registerOnTestnet: vi.fn(),
  authenticatedWalletSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));
vi.mock("@/lib/client/wallet", () => ({
  walletLogin,
  registerOnTestnet,
  authenticatedWalletSession,
}));

import { RegistrationForm } from "@/components/registration-form";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

authenticatedWalletSession.mockRejectedValue(new Error("No existing session"));

describe("registration redirect status", () => {
  it("redirects a registered wallet login to dashboard", async () => {
    sessionStorage.setItem("landing-inline-mode", "signup");
    walletLogin.mockResolvedValue({
      wallet: "0x000000000000000000000000000000000000dead",
      registered: true,
    });
    render(<RegistrationForm registrationEnabled />);
    fireEvent.change(screen.getByLabelText("Sponsor Wallet"), {
      target: { value: "0x00000000000000000000000000000000000000aa" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Signup" }).closest("form")!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(sessionStorage.getItem("landing-inline-mode")).toBeNull();
    expect(registerOnTestnet).not.toHaveBeenCalled();
  });

  it("continues registration only for a genuinely unregistered wallet", async () => {
    walletLogin.mockResolvedValue({
      wallet: "0x000000000000000000000000000000000000dead",
      registered: false,
    });
    registerOnTestnet.mockResolvedValue({ txHash: `0x${"1".repeat(64)}`, alreadyRegistered: false });
    render(<RegistrationForm registrationEnabled />);
    fireEvent.change(screen.getByLabelText("Sponsor Wallet"), {
      target: { value: "0x00000000000000000000000000000000000000aa" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Signup" }).closest("form")!);
    await waitFor(() => expect(registerOnTestnet).toHaveBeenCalledTimes(1));
  });

  it("does not create a redirect loop when preparation reports already registered before projection is ACTIVE", async () => {
    sessionStorage.setItem("landing-inline-mode", "signup");
    walletLogin.mockResolvedValue({
      wallet: "0x000000000000000000000000000000000000dead",
      registered: false,
    });
    registerOnTestnet.mockResolvedValue({ alreadyRegistered: true });
    render(<RegistrationForm registrationEnabled />);
    fireEvent.change(screen.getByLabelText("Sponsor Wallet"), {
      target: { value: "0x00000000000000000000000000000000000000aa" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Signup" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("synchronization is pending"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects an ACTIVE session away from signup before registration preparation", async () => {
    authenticatedWalletSession.mockResolvedValueOnce({
      wallet: "0x000000000000000000000000000000000000dead",
      chainId: 97,
      registered: true,
      registrationState: "ACTIVE",
    });
    render(<RegistrationForm registrationEnabled />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(walletLogin).not.toHaveBeenCalled();
    expect(registerOnTestnet).not.toHaveBeenCalled();
  });
});
