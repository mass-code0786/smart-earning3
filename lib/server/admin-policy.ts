import { getAddress } from "ethers";
import { ApiError } from "./http";

export function configuredAdminWallets(value = process.env.ADMIN_WALLETS) {
  if (!value?.trim()) return new Set<string>();
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return new Set(entries.map((wallet) => getAddress(wallet).toLowerCase()));
}

export function isConfiguredAdmin(wallet: string, value = process.env.ADMIN_WALLETS) {
  try {
    return configuredAdminWallets(value).has(getAddress(wallet).toLowerCase());
  } catch {
    return false;
  }
}

export function assertConfiguredAdmin(wallet: string) {
  if (!isConfiguredAdmin(wallet)) {
    throw new ApiError(403, "Administrator access required", "ADMIN_REQUIRED");
  }
  return getAddress(wallet).toLowerCase();
}
