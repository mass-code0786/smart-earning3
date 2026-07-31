// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import {
  PRODUCTION_CWD, selectProductionPm2Process,
} from "@/lib/server/pm2-production";

const require = createRequire(import.meta.url);
const { loadProductionPm2Environment } = require(
  "../scripts/pm2-environment.cjs",
) as {
  loadProductionPm2Environment: (
    path: string,
    environment?: Record<string, string | undefined>,
  ) => Record<string, string | undefined>;
};

const production = {
  name: "smart-earning",
  pm2_env: {
    pm_cwd: PRODUCTION_CWD,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@production-db/smart",
  },
};

describe("PM2 production database targeting", () => {
  it("selects and redacts the exact PM2 DATABASE_URL", () => {
    expect(selectProductionPm2Process([production])).toMatchObject({
      databaseUrl: production.pm2_env.DATABASE_URL,
      databaseIdentity: { host: "production-db", database: "smart", user: "app" },
    });
  });

  it("refuses missing, duplicate, wrong-cwd, or non-production processes", () => {
    expect(() => selectProductionPm2Process([])).toThrow("exactly one");
    expect(() => selectProductionPm2Process([production, production])).toThrow("found 2");
    expect(() => selectProductionPm2Process([{
      ...production, pm2_env: { ...production.pm2_env, pm_cwd: "/wrong" },
    }])).toThrow("found 0");
    expect(() => selectProductionPm2Process([{
      ...production, pm2_env: { ...production.pm2_env, NODE_ENV: "development" },
    }])).toThrow("NODE_ENV=production");
  });

  it("requires the smart-earning process name as well as the production cwd", () => {
    expect(() => selectProductionPm2Process([{
      ...production,
      name: "another-app",
    }])).toThrow("found 0");
  });

  it("production migration uses PM2 DATABASE_URL and requires confirmation", () => {
    const source = readFileSync(resolve("scripts/migrate-production.ts"), "utf8");
    expect(source).toContain("--confirm-production-database");
    expect(source).toContain("DATABASE_URL: selected.databaseUrl");
    expect(source).toContain('PRODUCTION_DATABASE_SOURCE: "pm2"');
    expect(source).not.toContain("loadEnvConfig");
    const worker = readFileSync(resolve("scripts/migrate.ts"), "utf8");
    expect(worker).toContain('"/var/www/smart-earning3"');
    expect(worker).toContain('["pm2","validated-deploy"]');
  });

  it("ecosystem loads .env safely, preserves precedence, and survives saved PM2 state", () => {
    const loaded = loadProductionPm2Environment(resolve(".env.example"), {
      DATABASE_URL: "postgresql://override:secret@production-db/live",
      EXISTING_ONLY: "preserved",
    });
    expect(loaded.DATABASE_URL).toBe(
      "postgresql://override:secret@production-db/live",
    );
    expect(loaded.NEXT_PUBLIC_NETWORK_NAME).toBe("BNB Smart Chain Testnet");
    expect(loaded.EXISTING_ONLY).toBe("preserved");
    expect(loaded.NODE_ENV).toBe("production");

    const ecosystem = readFileSync(resolve("ecosystem.config.cjs"), "utf8");
    expect(ecosystem).toContain("loadProductionPm2Environment");
    expect(ecosystem).toContain("...productionEnvironment");
    expect(ecosystem).toContain("DATABASE_URL: productionEnvironment.DATABASE_URL");
    expect(ecosystem).toContain('instances: 1');
    expect(ecosystem).toContain('name: "smart-earning"');
  });

  it("fails closed without DATABASE_URL and does not log secrets", () => {
    const emptyEnv = resolve("test/fixtures/empty-production.env");
    expect(() => loadProductionPm2Environment(emptyEnv, {})).toThrow(
      "DATABASE_URL is missing",
    );
    const source = readFileSync(
      resolve("scripts/pm2-environment.cjs"),
      "utf8",
    );
    expect(source).not.toMatch(/console\.(log|info|debug)/);
  });

  it("parses quoted spaces and special characters without shell evaluation", () => {
    const loaded = loadProductionPm2Environment(
      resolve("test/fixtures/empty-production.env"),
      { DATABASE_URL: "postgresql://app:secret@db/production" },
    );
    expect(loaded.QUOTED_VALUE).toBe(
      "spaces, # symbols, and $pecial characters",
    );
    expect(loaded.NEXT_PUBLIC_NETWORK_NAME).toBe("BNB Smart Chain Testnet");
  });

  it("readiness and the safe check fail when PM2 omits DATABASE_URL", () => {
    expect(() => selectProductionPm2Process([{
      name: "smart-earning",
      pm2_env: { pm_cwd: PRODUCTION_CWD, NODE_ENV: "production" },
    }])).toThrow("does not provide DATABASE_URL");

    const readiness = readFileSync(
      resolve("scripts/verify-production-readiness.ts"),
      "utf8",
    );
    const check = readFileSync(
      resolve("scripts/check-pm2-environment.ts"),
      "utf8",
    );
    expect(readiness).toContain("selectProductionPm2Process");
    expect(check).toContain("hasDatabaseUrl");
    expect(check).not.toContain("databaseUrl:");
  });
});
