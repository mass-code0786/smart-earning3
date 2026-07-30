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

  it("normal live path never calls eth_getLogs or getLogs", () => {
    const worker = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    const core = readFileSync(resolve("scripts/indexer-core.ts"), "utf8");
    const rpc = readFileSync(resolve("lib/blockchain/indexer-rpc.ts"), "utf8");
    expect(`${worker}\n${core}\n${rpc}`).not.toMatch(/eth_getLogs|\.getLogs\s*\(/);
    expect(rpc).toContain('"eth_getBlockByNumber"');
    expect(rpc).toContain('"eth_getTransactionReceipt"');
  });

  it("uses only exact relevant events already present in the ABI", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    expect(source).toContain('"UserRegistered"');
    expect(source).toContain('"PackagePurchased"');
    expect(source).not.toContain("ReferralCreated");
    expect(source).not.toContain("Upgraded");
  });
});
