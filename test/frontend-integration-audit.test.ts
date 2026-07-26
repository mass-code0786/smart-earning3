import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatTokenUnits } from "@/lib/client/money";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("frontend production integration safeguards", () => {
  it("uses the unified contract and has no legacy package contract configuration", () => {
    const frontend = [read("lib/client/wallet.ts"), read("components/package-page.tsx"), read(".env.example")].join("\n");
    expect(frontend).toContain("SMART_EARNING_CONTRACT_ADDRESS");
    expect(frontend).not.toContain("SMART_EARNING_PACKAGE_CONTRACT_ADDRESS");
    expect(frontend).not.toContain("NEXT_PUBLIC_SMART_EARNING_PACKAGE_CONTRACT_ADDRESS");
  });

  it("has no ordinary manual withdrawal action", () => {
    const withdrawal = read("components/withdrawal-status.tsx");
    expect(withdrawal).toContain("No withdrawal button is required");
    expect(withdrawal).not.toMatch(/onClick=.*withdraw/i);
  });

  it("renders monetary token units without floating point loss", () => {
    expect(formatTokenUnits("9007199254740993123456")).toBe("$9,007,199,254,740,993.12");
    expect(formatTokenUnits("1000000")).toBe("$1.00");
    expect(formatTokenUnits("50000")).toBe("$0.05");
  });

  it("uses backend split and cap values in income history", () => {
    const income = read("components/live-plan-data.tsx");
    for (const field of ["gross_calculated", "capped_gross_credit", "capped_excess", "magic_amount", "income_amount"]) {
      expect(income).toContain(field);
    }
  });

  it("uses server module pause states for atomic package availability", () => {
    const page = read("components/package-page.tsx");
    const service = read("lib/server/package-service.ts");
    for (const module of ["PACKAGE_PURCHASE", "X3_PLACEMENT", "X4_PLACEMENT"]) expect(service).toContain(module);
    expect(page).toContain("modulePauses");
    expect(page).toContain("disabled={paused");
  });

  it("keeps reconciliation read-only and requires reasons for admin writes", () => {
    const panel = read("components/operations-admin-panel.tsx");
    expect(panel).not.toMatch(/repair balance|edit balance|delete ledger/i);
    expect(panel).toContain("Reason for this read-only reconciliation run");
    expect(panel).toContain("Resolution note (required)");
    expect(panel).toContain("confirmationPhrase");
  });
});
