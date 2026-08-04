const DEFAULT_DECIMALS = 6;

export function tokenDecimals() {
  const configured = process.env.NEXT_PUBLIC_USDT_DECIMALS;
  return configured && /^\d+$/.test(configured) ? Number.parseInt(configured, 10) : DEFAULT_DECIMALS;
}

export function formatTokenUnits(value: string | bigint | null | undefined, options: { decimals?: number; displayDecimals?: number; symbol?: string } = {}) {
  const decimals = options.decimals ?? tokenDecimals();
  const displayDecimals = options.displayDecimals ?? 2;
  let amount: bigint;
  try { amount = typeof value === "bigint" ? value : BigInt(value || "0"); } catch { amount = 0n; }
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const displayScale = 10n ** BigInt(displayDecimals);
  const rounded = (absolute * displayScale + scale / 2n) / scale;
  const shown = displayDecimals === 0 ? "" : `.${(rounded % displayScale).toString().padStart(displayDecimals, "0")}`;
  return `${negative ? "-" : ""}${options.symbol ?? "$"}${(rounded / displayScale).toLocaleString("en-US")}${shown}`;
}

export function formatDecimalAmount(value: string | number | null | undefined, options: { displayDecimals?: number; symbol?: string } = {}) {
  const raw = String(value ?? "0").trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) return formatTokenUnits(0n, { decimals: 0, ...options });
  const fraction = match[3] || "";
  const units = BigInt(`${match[2]}${fraction}` || "0") * (match[1] === "-" ? -1n : 1n);
  return formatTokenUnits(units, { decimals: fraction.length, ...options });
}

export function percentageBasisPoints(used: string | bigint, total: string | bigint) {
  const numerator = typeof used === "bigint" ? used : BigInt(used || "0");
  const denominator = typeof total === "bigint" ? total : BigInt(total || "0");
  if (denominator <= 0n) return 0;
  const basisPoints = numerator * 10_000n / denominator;
  return Number(basisPoints > 10_000n ? 10_000n : basisPoints) / 100;
}
