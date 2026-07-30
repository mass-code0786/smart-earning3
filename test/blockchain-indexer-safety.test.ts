// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("live blockchain indexer safety", () => {
  it("submits no blockchain transaction", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    expect(source).not.toMatch(/new\s+Wallet|Contract\s*\(|sendTransaction|\.register\s*\(|\.purchasePackage\s*\(/);
    expect(source).toContain("verifyAndActivateRegistration");
    expect(source).toContain("verifyPackagePurchase");
  });

  it("uses only exact relevant events already present in the ABI", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    expect(source).toContain('"UserRegistered"');
    expect(source).toContain('"PackagePurchased"');
    expect(source).not.toContain("ReferralCreated");
    expect(source).not.toContain("Upgraded");
  });
});
