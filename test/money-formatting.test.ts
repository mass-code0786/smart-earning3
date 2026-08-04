import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDecimalAmount, formatTokenUnits } from "@/lib/client/money";

describe("shared monetary display formatting", () => {
  it.each([
    ["2", "$2.00"],
    ["2.000000000000", "$2.00"],
    ["1.275", "$1.28"],
    ["0", "$0.00"],
    ["1000.5", "$1,000.50"],
  ])("formats decimal amount %s", (value, expected) => {
    expect(formatDecimalAmount(value)).toBe(expected);
  });

  it("rounds token units without floating-point arithmetic", () => {
    expect(formatTokenUnits("1275000")).toBe("$1.28");
    expect(formatTokenUnits("999999")).toBe("$1.00");
    expect(formatTokenUnits("2000000000000")).toBe("$2,000,000.00");
  });

  it("never renders NaN for missing or invalid values", () => {
    expect(formatTokenUnits(undefined)).toBe("$0.00");
    expect(formatTokenUnits(null)).toBe("$0.00");
    expect(formatDecimalAmount("invalid")).toBe("$0.00");
  });

  it("routes major authenticated monetary surfaces through the shared formatter", () => {
    for (const file of [
      "real-dashboard.tsx", "live-plan-data.tsx", "real-wallet.tsx", "history-page.tsx",
      "package-page.tsx", "x3-page.tsx", "x4-page.tsx", "booster-page.tsx",
      "autopool-page.tsx", "dividend-page.tsx", "real-team.tsx",
    ]) {
      expect(readFileSync(resolve("components", file), "utf8")).toMatch(/formatTokenUnits|formatDecimalAmount/);
    }
  });

  it("does not format non-money team counts, package numbers or matrix positions", () => {
    const team = readFileSync(resolve("components/real-team.tsx"), "utf8");
    const x3 = readFileSync(resolve("components/x3-page.tsx"), "utf8");
    expect(team).toContain("data.directMembers");
    expect(x3).toContain("Package {item.packageId}");
    expect(x3).toContain("Slot {position}");
  });
});
