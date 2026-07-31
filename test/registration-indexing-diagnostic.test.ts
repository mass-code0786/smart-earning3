// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { describe, expect, it } from "vitest";

describe("read-only registration indexing diagnostic", () => {
  const source = readFileSync(resolve("scripts/diagnose-registration-indexing.ts"), "utf8");

  it("does not call the getter omitted from the shared contract interface", () => {
    const contractInterface = new Interface(SMART_EARNING_ABI);
    expect(contractInterface.hasFunction("matrixIndexOf")).toBe(false);
    expect(source).not.toContain("contract.matrixIndexOf");
  });

  it("uses the canonical registration event discovery for placement fields", () => {
    const registration = new Interface(SMART_EARNING_ABI).getEvent("UserRegistered")!;
    expect(registration.inputs.map((input) => input.name)).toEqual([
      "user", "sponsor", "matrixParent", "matrixIndex", "matrixPosition",
      "directSponsorIncome", "magicWalletCredit",
    ]);
    expect(source).toContain("findRegistrationTransactionForWallet");
    expect(source).toContain("discovered?.sponsor");
    expect(source).toContain("discovered?.matrixIndex");
    expect(source).toContain("discovered?.matrixPosition");
  });

  it("remains read-only and reports rows, checkpoint position, missing projections and diagnosis", () => {
    expect(source).not.toMatch(/--apply|\b(?:INSERT|UPDATE|DELETE)\b/);
    for (const value of [
      "blockchainTransactions", "processedEvents", "matrixPlacements", "checkpoints",
      "registrationBlockPosition", "missingProjectionRows", "finalDiagnosis",
    ]) expect(source).toContain(value);
  });

  it("bounds every external subsystem and reports scan progress", () => {
    expect(source).toContain("RPC_TIMEOUT_MS");
    expect(source).toContain("EVENT_DISCOVERY_TIMEOUT_MS");
    expect(source).toContain("DATABASE_TIMEOUT_MS");
    expect(source).toContain("SET LOCAL statement_timeout");
    expect(source).toContain("RPC: querying UserRegistered logs");
    expect(source).toContain("database: reading diagnostic projection rows and checkpoints");
  });

  it("closes diagnostic resources and assigns an exit code on every outcome", () => {
    expect(source).toContain("diagnosticClient.release(true)");
    expect(source).toContain("diagnosticPool.end()");
    expect(source).toContain("diagnosticProvider.destroy()");
    expect(source).toContain("process.exitCode = 0");
    expect(source).toContain("process.exitCode = 2");
    expect(source).toContain('code: "DIAGNOSTIC_FAILED"');
  });
});
