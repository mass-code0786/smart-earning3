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

  it("starts a new checkpoint before the contract deployment block", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    expect(source).toContain("SMART_EARNING_DEPLOYMENT_BLOCK");
    expect(source).toContain("deploymentBlock - 1");
    expect(source).toContain("configuredInitialCheckpoint");
  });

  it("rewinds legacy safe-head checkpoints exactly once before historical replay", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    const migration = readFileSync(
      resolve("database/migrations/027_indexer_history_checkpoint.sql"), "utf8",
    );
    expect(migration).toContain("history_start_block");
    expect(source).toContain("history_start_block IS NULL");
    expect(source).toContain("LEAST(state.last_processed_block,$3)");
    expect(source).toContain("reconcileLegacyIndexerCheckpoint");
    expect(source.indexOf("reconcileLegacyIndexerCheckpoint(\n    CHAIN_ID"))
      .toBeLessThan(source.indexOf("initializeForwardIndexer({"));
  });

  it("records checkpoint history origin for every newly initialized indexer", () => {
    const source = readFileSync(resolve("lib/server/blockchain-indexer.ts"), "utf8");
    expect(source).toContain("last_processed_block,history_start_block");
    expect(source).toContain("VALUES($1,$2,$3,$3)");
  });
});
