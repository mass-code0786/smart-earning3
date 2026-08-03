type ProviderError = {
  code?: string | number;
  message?: string;
  shortMessage?: string;
  reason?: string;
  error?: ProviderError;
  info?: { error?: ProviderError };
  data?: { message?: string } | string;
};

function diagnosticText(error: unknown) {
  const candidate = error as ProviderError | null;
  const nested = candidate?.error;
  const info = candidate?.info?.error;
  return [
    candidate?.code,
    candidate?.shortMessage,
    candidate?.reason,
    candidate?.message,
    nested?.code,
    nested?.message,
    info?.code,
    info?.message,
    typeof candidate?.data === "string" ? candidate.data : candidate?.data?.message,
  ].filter(value => typeof value === "string" || typeof value === "number").join(" ").toLowerCase();
}

export function formatBlockchainError(error: unknown, fallback = "Transaction could not be completed. Please try again.") {
  const code = (error as ProviderError | null)?.code;
  const text = diagnosticText(error);
  if (code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied)|request rejected/.test(text)) {
    return "Transaction was rejected in your wallet.";
  }
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds|intrinsic transaction cost/.test(text)) {
    return "Insufficient BNB balance for network gas fee. Please add BNB to your wallet and try again.";
  }
  if (/insufficient usdt|erc20insufficientbalance|transfer amount exceeds balance/.test(text)) {
    return "Insufficient USDT balance. Please add USDT to your wallet and try again.";
  }
  if (/insufficient (token )?allowance|erc20insufficientallowance/.test(text)) {
    return "Insufficient token allowance. Please approve USDT and try again.";
  }
  if (code === "WRONG_NETWORK" || /wrong network|unsupported network|chain id|switch to bnb/.test(text)) {
    return "Wrong network. Please switch to BNB Smart Chain Testnet and try again.";
  }
  if (code === "CALL_EXCEPTION" || /execution reverted|transaction reverted|reverted with/.test(text)) {
    return "Transaction reverted. Please verify the details and try again.";
  }
  if (["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT"].includes(String(code))
      || /failed to fetch|network request failed|rpc.*(unavailable|error)|timeout|too many requests|\b429\b|\b503\b/.test(text)) {
    return "Network RPC is temporarily unavailable. Please try again shortly.";
  }
  if (/package has already been purchased/.test(text)) return "Package has already been purchased.";
  const sequence = text.match(/package (\d+) must be purchased next/);
  if (sequence) return `Package ${sequence[1]} must be purchased next.`;
  return fallback;
}

export function presentBlockchainError(context: string, error: unknown, fallback?: string) {
  console.error(context, error);
  return formatBlockchainError(error, fallback);
}
