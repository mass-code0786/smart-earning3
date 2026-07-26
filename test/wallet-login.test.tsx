import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh, walletLoginMock, switchMock } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  walletLoginMock: vi.fn(),
  switchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/client/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/wallet")>();
  return {
    ...actual,
    walletLogin: walletLoginMock,
    switchToTestnet: switchMock,
  };
});

import { WalletLogin } from "@/components/wallet-login";
import { WalletLoginError } from "@/lib/client/wallet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("wallet login UI", () => {
  it("prevents duplicate connect/sign requests synchronously", async () => {
    let resolve!: () => void;
    walletLoginMock.mockReturnValue(new Promise((done) => {
      resolve = () => done({ registered: true });
    }));
    render(<WalletLogin />);
    const button = screen.getByRole("button", { name: "Connect & Sign" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(walletLoginMock).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it.each([
    ["WALLET_MISSING", "Wallet not detected"],
    ["WALLET_REJECTED", "Wallet connection rejected"],
    ["SIGNATURE_REJECTED", "Signature rejected"],
    ["NONCE_FAILED", "Could not request login nonce"],
    ["VERIFY_FAILED", "Signature verification failed"],
    ["SESSION_FAILED", "Session could not be created"],
    ["SERVER_CONFIG_INCOMPLETE", "Server configuration incomplete"],
    ["NETWORK_ERROR", "Network request failed"],
  ] as const)("shows %s and always resets loading", async (code, message) => {
    walletLoginMock.mockRejectedValue(new WalletLoginError(code, message));
    render(<WalletLogin />);
    fireEvent.click(screen.getByRole("button", { name: "Connect & Sign" }));
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Connect & Sign" })).toBeEnabled();
  });

  it("offers a BNB Testnet switch action for the wrong chain", async () => {
    walletLoginMock.mockRejectedValue(
      new WalletLoginError("WRONG_NETWORK", "Switch to BNB Smart Chain Testnet"),
    );
    render(<WalletLogin />);
    fireEvent.click(screen.getByRole("button", { name: "Connect & Sign" }));
    expect(await screen.findByRole("button", {
      name: "Switch to BNB Smart Chain Testnet",
    })).toBeEnabled();
  });

  it("sends an authenticated but unregistered wallet to registration", async () => {
    walletLoginMock.mockResolvedValue({
      wallet: "0x000000000000000000000000000000000000dead",
      chainId: 97,
      registered: false,
    });
    render(<WalletLogin />);
    fireEvent.click(screen.getByRole("button", { name: "Connect & Sign" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/register"));
  });
});
