// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("activity history schema repair migration", () => {
  const canonical = readFileSync(
    resolve("database/migrations/022_activity_history.sql"), "utf8",
  );
  const repair = readFileSync(
    resolve("database/migrations/024_repair_activity_history_schema.sql"), "utf8",
  );
  const runner = readFileSync(resolve("scripts/migrate.ts"), "utf8");

  it("makes canonical history DDL idempotent", () => {
    expect(canonical).toContain("CREATE TABLE IF NOT EXISTS activity_history");
    expect(canonical).toContain("CREATE OR REPLACE FUNCTION write_activity_history_from_source()");
    expect(canonical).toContain("DROP TRIGGER IF EXISTS activity_history_referral");
    expect(canonical).toContain("CREATE INDEX IF NOT EXISTS activity_history_created_idx");
  });

  it("replays canonical DDL transactionally and repairs bookkeeping", () => {
    expect(repair).toContain("-- include-migration:022_activity_history.sql");
    expect(repair).toContain("ON CONFLICT(filename) DO NOTHING");
    expect(runner).toContain("include-migration:");
    expect(runner).toContain("ON CONFLICT(filename) DO NOTHING");
  });

  it("preserves history and does not mutate financial or registration records", () => {
    expect(repair).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP TABLE)\b/i);
    expect(repair).not.toMatch(
      /\b(?:INSERT INTO|UPDATE)\s+(?:registrations|referral_relations|income_\w+|magic_\w+|x3_\w+)/i,
    );
    expect(canonical).not.toMatch(/\b(?:DELETE FROM|TRUNCATE)\s+activity_history\b/i);
  });
});
