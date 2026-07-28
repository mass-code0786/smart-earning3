import { parseUnits } from "ethers";

export function normalizeBoosterAmountInput(raw: string, decimals = 6) {
  if (raw === "") return "";
  if (!new RegExp(`^\\d*(?:\\.\\d{0,${decimals}})?$`).test(raw)) return null;
  const [wholeRaw, fraction] = raw.split(".");
  const whole = (wholeRaw || "0").replace(/^0+(?=\d)/, "") || "0";
  return fraction === undefined ? whole : `${whole}.${fraction}`;
}

export function boosterAmountTokenUnits(value: string, decimals = 6) {
  if (!value || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) {
    throw new Error("Enter a valid top-up amount");
  }
  const amount = parseUnits(value, decimals);
  if (amount <= 0n) throw new Error("Top-up amount must be greater than zero");
  return amount;
}
