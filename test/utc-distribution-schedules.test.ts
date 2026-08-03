import { afterEach, describe, expect, it } from "vitest";
import { getDividendConfig, isDividendSettlementDue } from "@/lib/server/dividend-config";
import { getMagicDistributionConfig, isMagicDistributionDue } from "@/lib/server/magic-distribution-config";

const original = {
  TZ: process.env.TZ,
  magicTimezone: process.env.MAGIC_DISTRIBUTION_TIMEZONE,
  magicHour: process.env.MAGIC_DISTRIBUTION_HOUR,
  magicMinute: process.env.MAGIC_DISTRIBUTION_MINUTE,
  dividendTimezone: process.env.DAILY_DIVIDEND_TIMEZONE,
  dividendHour: process.env.DAILY_DIVIDEND_SETTLEMENT_HOUR,
  dividendMinute: process.env.DAILY_DIVIDEND_SETTLEMENT_MINUTE,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    TZ: original.TZ,
    MAGIC_DISTRIBUTION_TIMEZONE: original.magicTimezone,
    MAGIC_DISTRIBUTION_HOUR: original.magicHour,
    MAGIC_DISTRIBUTION_MINUTE: original.magicMinute,
    DAILY_DIVIDEND_TIMEZONE: original.dividendTimezone,
    DAILY_DIVIDEND_SETTLEMENT_HOUR: original.dividendHour,
    DAILY_DIVIDEND_SETTLEMENT_MINUTE: original.dividendMinute,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("canonical UTC distribution schedules", () => {
  it("uses the required Magic and Dividend defaults", () => {
    delete process.env.MAGIC_DISTRIBUTION_TIMEZONE;
    delete process.env.MAGIC_DISTRIBUTION_HOUR;
    delete process.env.MAGIC_DISTRIBUTION_MINUTE;
    delete process.env.DAILY_DIVIDEND_TIMEZONE;
    delete process.env.DAILY_DIVIDEND_SETTLEMENT_HOUR;
    delete process.env.DAILY_DIVIDEND_SETTLEMENT_MINUTE;
    expect(getMagicDistributionConfig()).toEqual({ timezone: "UTC", hour: 6, minute: 30 });
    expect(getDividendConfig()).toMatchObject({ timezone: "UTC", settlementHour: 18, settlementMinute: 0 });
  });

  it("gates Dividend at exactly 18:00 UTC", () => {
    const config = { enabled: true, timezone: "UTC" as const, settlementHour: 18, settlementMinute: 0 };
    expect(isDividendSettlementDue(new Date("2026-08-03T17:59:59Z"), config)).toBe(false);
    expect(isDividendSettlementDue(new Date("2026-08-03T18:00:00Z"), config)).toBe(true);
  });

  it("is unaffected by server timezone", () => {
    const instant = new Date("2026-08-03T06:30:00Z");
    process.env.TZ = "America/Los_Angeles";
    expect(isMagicDistributionDue(instant, { timezone: "UTC", hour: 6, minute: 30 })).toBe(true);
    process.env.TZ = "Asia/Tokyo";
    expect(isMagicDistributionDue(instant, { timezone: "UTC", hour: 6, minute: 30 })).toBe(true);
  });

  it("maps the UTC instants to the requested India times", () => {
    const india = (value: string) => new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(value));
    expect(india("2026-08-03T06:30:00Z")).toBe("12:00");
    expect(india("2026-08-03T18:00:00Z")).toBe("23:30");
  });

  it("rejects ambiguous non-UTC configuration", () => {
    process.env.MAGIC_DISTRIBUTION_TIMEZONE = "Asia/Kolkata";
    expect(() => getMagicDistributionConfig()).toThrow("must be UTC");
    process.env.DAILY_DIVIDEND_TIMEZONE = "Asia/Kolkata";
    expect(() => getDividendConfig()).toThrow("must be UTC");
  });
});
