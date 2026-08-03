import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasRequiredMagicBalance } from "@/lib/server/distribution-service";

describe("Magic Level balance-gated distribution", () => {
  it("includes a user only when the required Magic balance is present", () => {
    expect(hasRequiredMagicBalance("1000000", "1000000")).toBe(true);
    expect(hasRequiredMagicBalance("1500000", "1000000")).toBe(true);
  });

  it("skips insufficient or unavailable balances without financial effects", () => {
    expect(hasRequiredMagicBalance("999999", "1000000")).toBe(false);
    expect(hasRequiredMagicBalance("0", "1000000")).toBe(false);
    expect(hasRequiredMagicBalance("1000000", null)).toBe(false);
    const source = readFileSync(resolve("lib/server/distribution-service.ts"), "utf8");
    expect(source).toContain("candidates.rows.filter(row => hasRequiredMagicBalance");
    expect(source).toContain("const skipped = candidates.rows.length - eligible.length");
    expect(source).not.toMatch(/UPDATE\s+users|DELETE\s+FROM\s+matrix_placements|UPDATE\s+matrix_placements/i);
  });

  it("keeps a supervised recurring scheduler and does not backfill old chain cycles", () => {
    const worker = readFileSync(resolve("scripts/magic-distribution-worker.ts"), "utf8");
    const ecosystem = readFileSync(resolve("ecosystem.config.cjs"), "utf8");
    const service = readFileSync(resolve("lib/server/distribution-service.ts"), "utf8");
    expect(worker).toContain("setInterval(() => void execute(), seconds * 1000)");
    expect(worker).toContain('isModulePaused("MAGIC_DISTRIBUTION_WORKER")');
    expect(ecosystem).toContain('worker("smart-earning-magic-distribution", "scripts/magic-distribution-worker.ts")');
    expect(service).toContain("const cycleId = BigInt(await contract.currentCycle())");
    expect(service).not.toMatch(/missedDistribution|backfillDistribution|previousCycle/i);
  });
});
