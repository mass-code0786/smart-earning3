import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  clear: vi.fn(async () => undefined),
  request: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/client/logout", () => ({
  clearUserSpecificClientState: state.clear,
}));
vi.mock("@/lib/client/wallet", () => ({
  getInjectedProvider: () => ({
    request: state.request,
    on: (event: string, listener: (...args: unknown[]) => void) =>
      state.listeners.set(event, listener),
    removeListener: (event: string) => state.listeners.delete(event),
  }),
}));

import { WalletSessionBoundary } from "@/components/wallet-session-boundary";

const wallet = "0x00000000000000000000000000000000000000bb";
const differentWallet = "0x00000000000000000000000000000000000000cc";

function logoutCalls() {
  return state.fetch.mock.calls.filter(([input]) => input === "/api/auth/logout");
}

describe("wallet account-change isolation", () => {
  beforeEach(() => {
    state.listeners.clear();
    state.clear.mockClear();
    state.request.mockReset();
    state.request.mockResolvedValue([wallet]);
    state.fetch.mockReset();
    state.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", state.fetch);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("wallet-binds protected API requests and disables shared response caching", async () => {
    render(<WalletSessionBoundary />);
    await fetch("/api/dashboard");
    expect(state.fetch).toHaveBeenCalledWith("/api/dashboard", expect.objectContaining({
      cache: "no-store",
      headers: expect.any(Headers),
    }));
    const options = state.fetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get("x-connected-wallet"))
      .toBe("0x00000000000000000000000000000000000000bb");
  });

  it("wallet-binds admin API requests", async () => {
    render(<WalletSessionBoundary />);
    await fetch("/api/admin/overview");
    const options = state.fetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get("x-connected-wallet"))
      .toBe("0x00000000000000000000000000000000000000bb");
  });

  it("keeps the post-registration dashboard open across transient provider hydration", async () => {
    state.request.mockResolvedValueOnce([]).mockResolvedValue([wallet]);
    render(<WalletSessionBoundary />);
    const response = await fetch("/api/dashboard");
    expect(response.status).toBe(200);
    expect(logoutCalls()).toHaveLength(0);
    expect(state.clear).not.toHaveBeenCalled();
  });

  it("does not logout when eth_accounts is transiently empty", async () => {
    state.request.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([wallet]);
    render(<WalletSessionBoundary />);
    const response = await fetch("/api/dashboard");
    expect(response.ok).toBe(true);
    expect(logoutCalls()).toHaveLength(0);
  });

  it("keeps the same connected and authenticated wallet active", async () => {
    render(<WalletSessionBoundary />);
    state.listeners.get("accountsChanged")?.([wallet]);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      headers: { "x-connected-wallet": wallet },
    })));
    expect(logoutCalls()).toHaveLength(0);
  });

  it("invalidates when the server confirms a different connected wallet", async () => {
    state.fetch.mockImplementation(async input => {
      if (input === "/api/auth/session") return new Response(JSON.stringify({
        error: "Wallet session mismatch", code: "SESSION_WALLET_MISMATCH",
      }), { status: 401, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    render(<WalletSessionBoundary />);
    state.listeners.get("accountsChanged")?.([differentWallet]);
    await waitFor(() => expect(logoutCalls()).toHaveLength(1));
    expect(state.clear).toHaveBeenCalledOnce();
  });

  it("invalidates an explicit disconnect only after it remains confirmed", async () => {
    state.request.mockResolvedValue([]);
    render(<WalletSessionBoundary />);
    state.listeners.get("disconnect")?.({ code: 4900 });
    expect(logoutCalls()).toHaveLength(0);
    await waitFor(() => expect(logoutCalls()).toHaveLength(1), { timeout: 1_500 });
    expect(state.request.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("does not invalidate on harmless chain-change account hydration noise", async () => {
    state.request.mockResolvedValueOnce([]).mockResolvedValue([wallet]);
    render(<WalletSessionBoundary />);
    state.listeners.get("chainChanged")?.("0x61");
    await waitFor(() => expect(state.request.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(logoutCalls()).toHaveLength(0);
  });

  it("invalidates a protected API SESSION_WALLET_MISMATCH response", async () => {
    state.fetch.mockImplementation(async input => {
      if (input === "/api/dashboard") return new Response(JSON.stringify({
        error: "Wallet session mismatch", code: "SESSION_WALLET_MISMATCH",
      }), { status: 401, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    render(<WalletSessionBoundary />);
    const response = await fetch("/api/dashboard");
    expect(response.status).toBe(401);
    await waitFor(() => expect(logoutCalls()).toHaveLength(1));
    expect(state.clear).toHaveBeenCalledOnce();
  });
});
