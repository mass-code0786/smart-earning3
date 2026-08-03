import { getInjectedProvider } from "@/lib/client/wallet";

function normalizeConnectedWallet(value: unknown) {
  if (typeof value !== "string") return "";
  const wallet = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
}

export async function authenticatedWalletFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const accounts = await getInjectedProvider().request({ method: "eth_accounts" });
  const wallet = normalizeConnectedWallet(Array.isArray(accounts) ? accounts[0] : null);
  if (!wallet) throw new Error("Wallet session mismatch");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set("x-connected-wallet", wallet);
  return fetch(input, {
    ...init,
    cache: "no-store",
    credentials: init.credentials || "same-origin",
    headers,
  });
}
