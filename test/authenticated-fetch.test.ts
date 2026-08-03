import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/client/wallet", () => ({
  getInjectedProvider: () => ({ request: state.request }),
}));

import { authenticatedWalletFetch } from "@/lib/client/authenticated-fetch";

describe("authenticated wallet fetch", () => {
  beforeEach(() => {
    state.request.mockReset();
    state.request.mockResolvedValue(["0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD"]);
    state.fetch.mockReset();
    state.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", state.fetch);
  });

  it("sends the normalized connected wallet with the session cookie", async () => {
    await authenticatedWalletFetch("/api/matrix/history?module=X3", { headers: { "x-test": "kept" } });
    expect(state.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(state.fetch).toHaveBeenCalledWith("/api/matrix/history?module=X3", expect.objectContaining({
      cache: "no-store", credentials: "same-origin", headers: expect.any(Headers),
    }));
    const headers = new Headers(state.fetch.mock.calls[0][1].headers);
    expect(headers.get("x-connected-wallet")).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(headers.get("x-test")).toBe("kept");
  });

  it("does not send a history request without a canonical connected wallet", async () => {
    state.request.mockResolvedValueOnce(["not-a-wallet"]);
    await expect(authenticatedWalletFetch("/api/matrix/history?module=X3")).rejects.toThrow("Wallet session mismatch");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
