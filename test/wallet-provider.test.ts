import { afterEach, describe, expect, it, vi } from "vitest";

const getAddress = vi.fn(async () => "0x000000000000000000000000000000000000dEaD");
const signMessage = vi.fn(async () => "0xsigned");

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    BrowserProvider: class {
      getSigner = async () => ({ getAddress, signMessage });
    },
  };
});

import {
  connectTestnet,
  getInjectedProvider,
  registerOnTestnet,
  walletLogin,
  WalletLoginError,
} from "@/lib/client/wallet";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function provider(chainId = "0x61", extra = {}) {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x000000000000000000000000000000000000dEaD"];
      if (method === "eth_accounts") return ["0x000000000000000000000000000000000000dEaD"];
      if (method === "eth_chainId") return chainId;
      return null;
    }),
    ...extra,
  };
}

describe("injected EIP-1193 support", () => {
  it("reports a missing wallet separately", () => {
    expect(() => getInjectedProvider({})).toThrowError(
      expect.objectContaining({ code: "WALLET_MISSING" }),
    );
  });

  it("selects TokenPocket from a standard multi-provider injection", () => {
    const other = provider();
    const tokenPocket = provider("0x61", { isTokenPocket: true });
    const ethereum = Object.assign(provider(), { providers: [other, tokenPocket] });
    expect(getInjectedProvider({ ethereum })).toBe(tokenPocket);
  });

  it("uses the standard provider before TokenPocket's legacy global", () => {
    const standard = provider();
    const legacy = provider();
    expect(getInjectedProvider({
      ethereum: standard,
      tokenpocket: { ethereum: legacy },
    })).toBe(standard);
  });

  it("requests accounts, reads chain ID, and rejects a wrong chain", async () => {
    const injected = provider("0x1");
    vi.stubGlobal("window", { ethereum: injected });
    await expect(connectTestnet()).rejects.toMatchObject({ code: "WRONG_NETWORK" });
    expect(injected.request).toHaveBeenNthCalledWith(1, { method: "eth_requestAccounts" });
    expect(injected.request).toHaveBeenNthCalledWith(2, { method: "eth_chainId" });
  });

  it("maps EIP-1193 user rejection without exposing the raw provider error", async () => {
    const injected = provider();
    injected.request.mockRejectedValueOnce({ code: 4001, message: "raw wallet detail" });
    vi.stubGlobal("window", { ethereum: injected });
    await expect(connectTestnet()).rejects.toEqual(
      new WalletLoginError("WALLET_REJECTED", "Wallet connection rejected"),
    );
  });
});

describe("nonce, signature, and session request flow", () => {
  it("sends the normalized wallet and exact server nonce/message payloads", async () => {
    const injected = provider();
    vi.stubGlobal("window", { ethereum: injected });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nonce: "a".repeat(48),
        message: "server-generated-message",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dead",
        chainId: 97,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dead",
        chainId: 97,
        registered: true,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await walletLogin();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/nonce");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      wallet: "0x000000000000000000000000000000000000dead",
    });
    expect(signMessage).toHaveBeenCalledWith("server-generated-message");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/verify");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      wallet: "0x000000000000000000000000000000000000dead",
      nonce: "a".repeat(48),
      signature: "0xsigned",
    });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/session");
  });

  it("maps an ACTIVE mixed-case session wallet to registered", async () => {
    vi.stubGlobal("window", { ethereum: provider() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        nonce: "a".repeat(48),
        message: "server-generated-message",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dead",
        chainId: 97,
      }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dEaD",
        chainId: 97,
        registered: false,
        registrationStatus: "ACTIVE",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(walletLogin()).resolves.toMatchObject({
      wallet: "0x000000000000000000000000000000000000dead",
      registered: true,
    });
  });

  it("treats preparation 409 ALREADY_REGISTERED as registered before any payment call", async () => {
    vi.stubGlobal("window", { ethereum: provider() });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dead",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Wallet is already registered",
        code: "ALREADY_REGISTERED",
      }), { status: 409 })));

    await expect(registerOnTestnet(
      "0x00000000000000000000000000000000000000aa",
      vi.fn(),
    )).resolves.toEqual({ alreadyRegistered: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("/api/registrations/prepare");
  });

  it("stops before approval when registration preparation fails", async () => {
    const injected = provider();
    vi.stubGlobal("window", { ethereum: injected });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        wallet: "0x000000000000000000000000000000000000dead",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Sponsor wallet is not active",
        code: "SPONSOR_NOT_ACTIVE",
      }), { status: 422 })));

    await expect(registerOnTestnet(
      "0x00000000000000000000000000000000000000aa",
      vi.fn(),
    )).rejects.toMatchObject({
      code: "SPONSOR_NOT_ACTIVE",
      message: "Sponsor wallet is not active",
    });
    expect(injected.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  });
});
