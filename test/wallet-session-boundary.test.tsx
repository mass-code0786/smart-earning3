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

describe("wallet account-change isolation", () => {
  beforeEach(() => {
    state.listeners.clear();
    state.clear.mockClear();
    state.request.mockReset();
    state.request.mockResolvedValue(["0x00000000000000000000000000000000000000bb"]);
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

  it.each(["accountsChanged", "disconnect", "chainChanged"])(
    "invalidates the server session and all client state on %s",
    async event => {
      render(<WalletSessionBoundary />);
      state.listeners.get(event)?.([]);
      await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
      }));
      expect(state.clear).toHaveBeenCalledOnce();
    },
  );
});
