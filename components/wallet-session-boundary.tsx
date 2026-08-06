"use client";

import { useEffect } from "react";
import { clearUserSpecificClientState } from "@/lib/client/logout";
import { getInjectedProvider } from "@/lib/client/wallet";

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

export function WalletSessionBoundary() {
  useEffect(() => {
    let provider: ReturnType<typeof getInjectedProvider>;
    try { provider = getInjectedProvider(); } catch { return; }
    const originalFetch = window.fetch.bind(window);
    let invalidating = false;

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

    window.fetch = async (input, init) => {
      const path = pathOf(input);
      if (!protectedApis.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
        return originalFetch(input, init);
      }
      const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
      const wallet = Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0].toLowerCase() : "";
      if (!wallet) {
        void invalidate(true);
        return new Response(JSON.stringify({
          error: "Wallet session mismatch", code: "SESSION_WALLET_MISMATCH",
        }), { status: 401, headers: { "content-type": "application/json" } });
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

    const changed = () => { void invalidate(true); };
    provider.on?.("accountsChanged", changed);
    provider.on?.("disconnect", changed);
    provider.on?.("chainChanged", changed);
    return () => {
      window.fetch = originalFetch;
      provider.removeListener?.("accountsChanged", changed);
      provider.removeListener?.("disconnect", changed);
      provider.removeListener?.("chainChanged", changed);
    };
  }, []);
  return null;
}
