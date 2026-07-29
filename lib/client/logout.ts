"use client";

import { getInjectedProvider } from "@/lib/client/wallet";

async function clearWalletSession() {
  try {
    const provider = getInjectedProvider();
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Not every injected wallet supports permission revocation. The app session is
    // still cleared, and connecting again will explicitly request wallet access.
  }
}

async function clearClientAuthState() {
  try {
    localStorage.clear();
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
  try {
    sessionStorage.clear();
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch {
      // Cache storage may be unavailable in private or restricted contexts.
    }
  }
}

export async function logoutAndRedirect(
  redirect = (url: string) => window.location.replace(url),
) {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  } finally {
    await clearClientAuthState();
    await clearWalletSession();
    redirect("/");
  }
}
