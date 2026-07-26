const DEFAULT_DECIMALS = 6;

export function tokenDecimals() {
  const configured = process.env.NEXT_PUBLIC_USDT_DECIMALS;
  return configured && /^\d+$/.test(configured) ? Number.parseInt(configured, 10) : DEFAULT_DECIMALS;
}

export function formatTokenUnits(value: string | bigint, options: { decimals?: number; displayDecimals?: number; symbol?: string } = {}) {
  const decimals = options.decimals ?? tokenDecimals();
  const displayDecimals = options.displayDecimals ?? 2;
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const shown = displayDecimals === 0 ? "" : `.${fraction.slice(0, displayDecimals).padEnd(displayDecimals, "0")}`;
  return `${negative ? "-" : ""}${options.symbol ?? "$"}${(absolute / scale).toLocaleString("en-US")}${shown}`;
}

export function percentageBasisPoints(used: string | bigint, total: string | bigint) {
  const numerator = typeof used === "bigint" ? used : BigInt(used || "0");
  const denominator = typeof total === "bigint" ? total : BigInt(total || "0");
  if (denominator <= 0n) return 0;
  const basisPoints = numerator * 10_000n / denominator;
  return Number(basisPoints > 10_000n ? 10_000n : basisPoints) / 100;
}
