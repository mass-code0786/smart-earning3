export type DividendConfig = {
  enabled: boolean;
  timezone: "UTC";
  settlementHour: number;
  settlementMinute: number;
};

function schedulePart(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be 0-${maximum}`);
  }
  return value;
}

export function getDividendConfig(): DividendConfig {
  const timezone = process.env.DAILY_DIVIDEND_TIMEZONE || "UTC";
  if (timezone !== "UTC") throw new Error("DAILY_DIVIDEND_TIMEZONE must be UTC");
  return {
    enabled: (process.env.DAILY_DIVIDEND_ENABLED || "true").toLowerCase() === "true",
    timezone,
    settlementHour: schedulePart("DAILY_DIVIDEND_SETTLEMENT_HOUR", 18, 23),
    settlementMinute: schedulePart("DAILY_DIVIDEND_SETTLEMENT_MINUTE", 0, 59),
  };
}

export function isDividendSettlementDue(now: Date, config = getDividendConfig()) {
  return now.getUTCHours() * 60 + now.getUTCMinutes()
    >= config.settlementHour * 60 + config.settlementMinute;
}
