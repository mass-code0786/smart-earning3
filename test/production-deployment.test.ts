// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  REQUIRED_NEXT_ARTIFACTS, verifyLiveIndexerSources, verifyNextArtifacts,
} from "@/lib/server/production-deployment";

const roots: string[] = [];
function temporaryRelease() {
  const root = mkdtempSync(join(tmpdir(), "smart-earning-release-"));
  roots.push(root);
  return root;
}
function write(root: string, path: string, value = "present") {
  const destination = join(root, path);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  writeFileSync(destination, value);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic production deployment", () => {
  it.each([
    ".next/server/app/page_client-reference-manifest.js",
    ".next/server/pages/500.html",
  ])("rejects a release missing %s", (missing) => {
    const root = temporaryRelease();
    for (const file of REQUIRED_NEXT_ARTIFACTS) {
      if (file !== missing) write(root, file, file.endsWith("BUILD_ID") ? "build-1" : "ok");
    }
    expect(() => verifyNextArtifacts(root)).toThrow(missing);
  });

  it("accepts only a complete non-empty build", () => {
    const root = temporaryRelease();
    for (const file of REQUIRED_NEXT_ARTIFACTS) {
      write(root, file, file.endsWith("BUILD_ID") ? "build-1" : "ok");
    }
    expect(verifyNextArtifacts(root).buildId).toBe("build-1");
    writeFileSync(join(root, ".next/BUILD_ID"), "");
    expect(() => verifyNextArtifacts(root)).toThrow("BUILD_ID is empty");
  });

  it("normal live indexer sources never call eth_getLogs", () => {
    expect(() => verifyLiveIndexerSources(process.cwd())).not.toThrow();
    const live = [
      "instrumentation.ts",
      "lib/server/blockchain-indexer.ts",
      "lib/blockchain/indexer-rpc.ts",
      "scripts/indexer-core.ts",
    ].map((file) => readFileSync(resolve(file), "utf8")).join("\n");
    expect(live).not.toMatch(/eth_getLogs|\.getLogs\s*\(/);
  });

  it("keeps getLogs only in emergency registration reconciliation", () => {
    const emergency = readFileSync(
      resolve("lib/server/registration-tx-reconciliation.ts"), "utf8",
    );
    expect(emergency).toMatch(/\.getLogs\s*\(/);
    expect(readFileSync(resolve("instrumentation.ts"), "utf8"))
      .not.toContain("registration-tx-reconciliation");
  });

  it("blocks duplicate indexers and rolls back after a failed switched release", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).toContain('name: "single_indexer"');
    expect(deployment).toContain("separate legacy indexer process");
    expect(deployment).toContain("rollback_previous_release: START");
    expect(deployment).toContain("SMART_EARNING_RELEASE_CWD: previousCwd");
    expect(deployment.indexOf('name: "next_artifacts"'))
      .toBeLessThan(deployment.indexOf('name: "pm2_reload"'));
  });

  it("detects runtime commit, build ID, and process/build-time mismatch", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).toContain("Running commit mismatch");
    expect(deployment).toContain("Running build ID mismatch");
    expect(deployment).toContain("Running PM2 script path mismatch");
    expect(deployment).toContain("did not start after the completed build");
    const ecosystem = readFileSync(resolve("ecosystem.config.cjs"), "utf8");
    expect(ecosystem).toContain("PM2 startup refused: incomplete Next.js build");
    expect(ecosystem).toContain("DEPLOYED_BUILD_ID");
  });

  it("contains no migration, database write, contract, or financial command", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).not.toMatch(/\bmigrate\b|INSERT\s|UPDATE\s|DELETE\s|hardhat|deploy-contract/);
    expect(deployment).toContain("verify:production-readiness");
  });
});
