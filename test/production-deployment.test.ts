// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
  REQUIRED_NEXT_ARTIFACTS, verifyLiveIndexerLogs, verifyLiveIndexerSources,
  verifyNextArtifacts,
} from "@/lib/server/production-deployment";

const require = createRequire(import.meta.url);
const {
  EXPECTED_NGINX_UPSTREAM_PORT,
  requireProductionPort,
} = require("../scripts/production-port.cjs") as {
  EXPECTED_NGINX_UPSTREAM_PORT: string;
  requireProductionPort: (environment: Record<string, string | undefined>) => string;
};

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
  it("requires the production port to match the Nginx upstream", () => {
    expect(EXPECTED_NGINX_UPSTREAM_PORT).toBe("3015");
    expect(requireProductionPort({ PORT: "3015" })).toBe("3015");
    expect(() => requireProductionPort({})).toThrow("PORT is required");
    expect(() => requireProductionPort({ PORT: "3000" })).toThrow(
      "does not match Nginx upstream 3015",
    );
  });

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

  it("checks eth_getLogs only after the latest live-indexer startup marker", () => {
    expect(() => verifyLiveIndexerLogs(
      "old method=eth_getLogs limit exceeded\nmode=block_receipt_indexing\nhealthy",
    )).not.toThrow();
    expect(() => verifyLiveIndexerLogs(
      "mode=block_receipt_indexing\nmethod=eth_getLogs limit exceeded",
    )).toThrow("Current live indexer run");
    expect(verifyLiveIndexerLogs("startup marker rotated out of recent logs"))
      .toEqual({ markerObserved: false });
  });

  it("blocks duplicate indexers and rolls back after a failed switched release", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).toContain("PM2_APPS");
    expect(deployment).toContain("Expected exactly one ${name} process");
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
    expect(ecosystem).toContain("requireProductionPort");
    expect(ecosystem).toContain('args: ["start", "--port", productionPort]');
    expect(deployment).toContain("Running PM2 port mismatch");
    expect(deployment).toContain("127.0.0.1:${productionPort}");
  });

  it("backs up and migrates before switching PM2 without contract or financial commands", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).toContain('name: "pre_migration_backup"');
    expect(deployment).toContain('name: "database_migrations"');
    expect(deployment).toContain('name: "prune_development_dependencies"');
    expect(deployment.indexOf('name: "database_migrations"')).toBeLessThan(deployment.indexOf('name: "pm2_reload"'));
    expect(deployment).not.toMatch(/INSERT\s|UPDATE\s|DELETE\s|hardhat|deploy-contract/);
    expect(deployment).toContain("verify:production-readiness");
  });

  it("automates backup scheduling, log rotation, TLS, and reboot startup", () => {
    const bootstrap = readFileSync(resolve("ops/bootstrap-production.sh"), "utf8");
    const timer = readFileSync(resolve("ops/smart-earning-backup.timer"), "utf8");
    const service = readFileSync(resolve("ops/smart-earning-backup.service"), "utf8");
    expect(bootstrap).toContain("systemctl enable --now smart-earning-backup.timer");
    expect(bootstrap).toContain("pm2 install pm2-logrotate");
    expect(bootstrap).toContain("pm2 startup systemd");
    expect(bootstrap).toContain("certbot --nginx --non-interactive");
    expect(timer).toContain("Persistent=true");
    expect(service).toContain("ops/postgres-backup.sh");
  });
});
