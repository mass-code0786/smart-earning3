// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRODUCTION_CWD, selectProductionPm2Process,
} from "@/lib/server/pm2-production";

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

  it("production migration uses PM2 DATABASE_URL and requires confirmation", () => {
    const source = readFileSync(resolve("scripts/migrate-production.ts"), "utf8");
    expect(source).toContain("--confirm-production-database");
    expect(source).toContain("DATABASE_URL: selected.databaseUrl");
    expect(source).toContain('PRODUCTION_DATABASE_SOURCE: "pm2"');
    expect(source).not.toContain("loadEnvConfig");
    const worker = readFileSync(resolve("scripts/migrate.ts"), "utf8");
    expect(worker).toContain('"/var/www/smart-earning3"');
    expect(worker).toContain('PRODUCTION_DATABASE_SOURCE !== "pm2"');
  });
});
