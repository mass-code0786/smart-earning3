import deployment from "@/deployments/bsc-testnet.json";

export function publicChainId() {
  const value = Number(process.env.NEXT_PUBLIC_SMART_EARNING_CHAIN_ID || deployment.chainId);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("NEXT_PUBLIC_SMART_EARNING_CHAIN_ID is invalid");
  return value;
}

export function publicNetworkName() {
  return process.env.NEXT_PUBLIC_NETWORK_NAME || `Chain ${publicChainId()}`;
}

export function transactionExplorerUrl(hash: string) {
  const base = process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL?.replace(/\/$/, "");
  return base && /^0x[a-fA-F0-9]{64}$/.test(hash) ? `${base}/tx/${hash}` : "#";
}
