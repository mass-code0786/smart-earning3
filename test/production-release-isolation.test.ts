// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEGACY_PRODUCTION_RELEASES_CWD,
  PRODUCTION_CWD,
  PRODUCTION_RELEASES_CWD,
  isProductionReleaseCwd,
} from "@/lib/server/pm2-production";
import {
  planProductionReleaseCleanup,
  type ProductionRelease,
} from "@/lib/server/production-release-cleanup";

describe("production release isolation", () => {
  it("creates releases outside the stable Git checkout", () => {
    expect(PRODUCTION_RELEASES_CWD).toBe("/var/www/smart-earning3-releases");
    expect(PRODUCTION_RELEASES_CWD.startsWith(`${PRODUCTION_CWD}/`)).toBe(false);
    expect(isProductionReleaseCwd(`${PRODUCTION_RELEASES_CWD}/new`)).toBe(true);
    expect(isProductionReleaseCwd(`${LEGACY_PRODUCTION_RELEASES_CWD}/active-old`)).toBe(true);
  });

  it("keeps the active release and at least the latest three successes", () => {
    const now = 2_000_000_000;
    const releases: ProductionRelease[] = [
      { cwd: "/releases/active", successful: true, modifiedAtMs: now - 5_000 },
      { cwd: "/releases/new-1", successful: true, modifiedAtMs: now - 1_000 },
      { cwd: "/releases/new-2", successful: true, modifiedAtMs: now - 2_000 },
      { cwd: "/releases/new-3", successful: true, modifiedAtMs: now - 3_000 },
      { cwd: "/releases/old", successful: true, modifiedAtMs: now - 6_000 },
      { cwd: "/releases/recent-failed", successful: false, modifiedAtMs: now - 1_000 },
      { cwd: "/releases/stale-failed", successful: false, modifiedAtMs: 0 },
    ];
    expect(planProductionReleaseCleanup(
      releases, "/releases/active", now, 3, 10_000,
    ).map((release) => release.cwd)).toEqual([
      "/releases/old",
      "/releases/stale-failed",
    ]);
  });

  it("excludes legacy in-checkout releases from TypeScript and Turbopack", () => {
    const tsconfig = JSON.parse(readFileSync(resolve("tsconfig.json"), "utf8")) as {
      exclude: string[];
    };
    expect(tsconfig.exclude).toContain("releases/**");
    const nextConfig = readFileSync(resolve("next.config.ts"), "utf8");
    expect(nextConfig).toContain("turbopack");
    expect(nextConfig).toContain("projectRoot");
  });

  it("verifies required deployment metadata before building a release", () => {
    const deployment = readFileSync(resolve("scripts/deploy-production.ts"), "utf8");
    expect(deployment).toContain("deployments/bsc-testnet.json");
    expect(deployment.indexOf('name: "release_source"'))
      .toBeLessThan(deployment.indexOf('name: "npm_ci"'));
    expect(deployment).toContain(".deployment-success.json");
  });

  it("cleanup covers legacy and external roots while protecting PM2 active cwd", () => {
    const cleanup = readFileSync(
      resolve("scripts/cleanup-production-releases.ts"), "utf8",
    );
    expect(cleanup).toContain("LEGACY_PRODUCTION_RELEASES_CWD");
    expect(cleanup).toContain("PRODUCTION_RELEASES_CWD");
    expect(cleanup).toContain("release.cwd === activeCwd");
    expect(cleanup).toContain("keepSuccessful: 3");
  });
});
