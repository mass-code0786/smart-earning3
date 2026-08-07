// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(file), "utf8");

describe("package-only cap testnet redeployment readiness", () => {
  it("guards deployment and records the cap policy plus runtime bytecode", () => {
    const source = read("scripts/deploy-contract.cjs");
    expect(source).toContain("DEPLOY_PACKAGE_ONLY_CAP_TESTNET");
    expect(source).toContain('policy: "PACKAGE_ONLY_5X_V1"');
    expect(source).toContain("deployedBytecodeHash");
    expect(source).toContain("provider.getCode(contractAddress)");
    expect(source).toContain('"bsc-testnet-x3-aligned.json"');
    expect(source).toContain('Number(network.chainId) !== 97');
  });

  it("configures and verifies worker roles without printing private keys", () => {
    const configure = read("scripts/configure-testnet-roles.cjs");
    const check = read("scripts/check-testnet-deployment.cjs");
    expect(configure).toContain("CONFIGURE_PACKAGE_ONLY_CAP_TESTNET");
    expect(configure).toContain("KEEPER_ROLE");
    expect(configure).toContain("WITHDRAWAL_EXECUTOR_ROLE");
    expect(check).toContain("configured keeper KEEPER_ROLE");
    expect(check).toContain("configured withdrawal executor WITHDRAWAL_EXECUTOR_ROLE");
    expect(configure).not.toMatch(/JSON\.stringify\([^)]*(?:PRIVATE_KEY|privateKey)/s);
  });

  it("has an explicit mutating smoke check for 0, 40 and 120 USDT caps", () => {
    const source = read("scripts/verify-package-only-cap-testnet.cjs");
    expect(source).toContain("VERIFY_PACKAGE_ONLY_CAP_TESTNET");
    expect(source).toContain('assertState(contract, verifier.address, 0n, 0n, "Registration-only")');
    expect(source).toContain('assertState(contract, verifier.address, 8_000_000n, 40_000_000n, "First package")');
    expect(source).toContain('assertState(contract, verifier.address, 24_000_000n, 120_000_000n, "Second package")');
  });

  it("documents the non-migrating state boundary and fresh-database requirement", () => {
    const runbook = read("docs/package-only-cap-testnet-redeployment.md");
    expect(runbook).toContain("not upgradeable and has no state-import function");
    expect(runbook).toContain("fresh migrated testnet database");
    expect(runbook).toContain("Do not switch the application contract address while retaining the old active database");
  });
});
