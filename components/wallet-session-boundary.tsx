"use client";

import { useEffect } from "react";
import { clearUserSpecificClientState } from "@/lib/client/logout";
import { getInjectedProvider } from "@/lib/client/wallet";

const IDENTITY_CONFIRMATION_ATTEMPTS = 4;
const IDENTITY_CONFIRMATION_DELAY_MS = 150;

const protectedApis = [
  "/api/auth/session", "/api/dashboard", "/api/wallet", "/api/team", "/api/history",
  "/api/packages", "/api/x3", "/api/x4", "/api/booster", "/api/autopool",
  "/api/dividend", "/api/withdrawals", "/api/registrations",
  "/api/admin",
];
const protectedPages = [
  "/dashboard", "/wallet", "/team", "/income", "/matrix", "/packages", "/booster",
  "/autopool", "/dividend", "/history", "/magic-level", "/menu",
  "/admin",
];

function pathOf(input: RequestInfo | URL) {
  try {
    const value = input instanceof Request ? input.url : String(input);
    return new URL(value, window.location.origin).pathname;
  } catch { return ""; }
}

function normalizedAccount(accounts: unknown) {
  const value = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof value !== "string") return "";
  const wallet = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export function WalletSessionBoundary() {
  useEffect(() => {
    let provider: ReturnType<typeof getInjectedProvider>;
    try { provider = getInjectedProvider(); } catch { return; }
    const originalFetch = window.fetch.bind(window);
    let invalidating = false;
    let disposed = false;
    let lastConfirmedWallet = "";
    let identityCheck: Promise<string> | null = null;
    let invalidateIfStillDisconnected = false;

    async function invalidate(preservePublicUrl: boolean) {
      if (invalidating) return;
      invalidating = true;
      try {
        await originalFetch("/api/auth/logout", {
          method: "POST", credentials: "same-origin", cache: "no-store",
        });
      } catch { /* client isolation still proceeds */ }
      await clearUserSpecificClientState();
      const isProtected = protectedPages.some(prefix =>
        location.pathname === prefix || location.pathname.startsWith(`${prefix}/`));
      if (preservePublicUrl && !isProtected) location.reload();
      else location.replace("/");
    }

    async function serverConfirmsWallet(wallet: string) {
      const response = await originalFetch("/api/auth/session", {
        credentials: "same-origin", cache: "no-store",
        headers: { "x-connected-wallet": wallet },
      }).catch(() => null);
      if (response?.status !== 401) return true;
      const body = await response.clone().json().catch(() => null);
      if (body?.code === "SESSION_WALLET_MISMATCH") {
        void invalidate(true);
        return false;
      }
      return true;
    }

    function confirmProviderIdentity(invalidateOnPersistentDisconnect: boolean) {
      invalidateIfStillDisconnected ||= invalidateOnPersistentDisconnect;
      if (identityCheck) return identityCheck;
      identityCheck = (async () => {
        for (let attempt = 0; attempt < IDENTITY_CONFIRMATION_ATTEMPTS; attempt += 1) {
          const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
          const wallet = normalizedAccount(accounts);
          if (wallet) {
            lastConfirmedWallet = wallet;
            invalidateIfStillDisconnected = false;
            await serverConfirmsWallet(wallet);
            return wallet;
          }
          if (attempt < IDENTITY_CONFIRMATION_ATTEMPTS - 1) {
            await new Promise(resolve => setTimeout(resolve, IDENTITY_CONFIRMATION_DELAY_MS));
          }
        }
        if (invalidateIfStillDisconnected && !disposed) void invalidate(true);
        invalidateIfStillDisconnected = false;
        return "";
      })().finally(() => { identityCheck = null; });
      return identityCheck;
    }

    window.fetch = async (input, init) => {
      const path = pathOf(input);
      if (!protectedApis.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
        return originalFetch(input, init);
      }
      const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
      let wallet = normalizedAccount(accounts);
      if (wallet) lastConfirmedWallet = wallet;
      if (!wallet) {
        wallet = lastConfirmedWallet;
        const confirmation = confirmProviderIdentity(false);
        if (!wallet) wallet = await confirmation;
      }
      if (!wallet) {
        return new Response(JSON.stringify({
          error: "Wallet provider is temporarily unavailable", code: "WALLET_PROVIDER_UNAVAILABLE",
        }), { status: 503, headers: { "content-type": "application/json" } });
      }
      const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => requestHeaders.set(key, value));
      requestHeaders.set("x-connected-wallet", wallet);
      const response = await originalFetch(input, { ...init, cache: "no-store", headers: requestHeaders });
      if (response.status === 401) {
        const body = await response.clone().json().catch(() => null);
        if (body?.code === "SESSION_WALLET_MISMATCH") void invalidate(true);
      }
      return response;
    };

    const accountsChanged = (accounts: unknown) => {
      const wallet = normalizedAccount(accounts);
      if (wallet) {
        lastConfirmedWallet = wallet;
        void serverConfirmsWallet(wallet);
      } else {
        void confirmProviderIdentity(true);
      }
    };
    const disconnected = () => { void confirmProviderIdentity(true); };
    const chainChanged = () => { void confirmProviderIdentity(false); };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("disconnect", disconnected);
    provider.on?.("chainChanged", chainChanged);
    return () => {
      disposed = true;
      window.fetch = originalFetch;
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("disconnect", disconnected);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, []);
  return null;
}
