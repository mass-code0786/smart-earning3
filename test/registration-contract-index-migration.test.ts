// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("contract-scoped registration matrix index migration", () => {
  const migration = readFileSync(
    resolve("database/migrations/030_contract_scoped_matrix_index.sql"), "utf8",
  );
  const service = readFileSync(resolve("lib/server/registration-service.ts"), "utf8");
  const runner = readFileSync(resolve("scripts/migrate.ts"), "utf8");
  const parentMigration = readFileSync(
    resolve("database/migrations/031_contract_scoped_matrix_parent_position.sql"), "utf8",
  );

  it("preserves the global bfs uniqueness constraint and allocates new database indexes by sequence", () => {
    expect(migration).toContain("matrix_placements_bfs_index_seq");
    expect(migration).toContain("max(bfs_index)");
    expect(migration).toContain("is_called THEN last_value+1");
    expect(migration).not.toContain("DROP CONSTRAINT IF EXISTS matrix_placements_bfs_index_key");
    expect(migration).not.toMatch(/UPDATE\s+matrix_placements/i);
    expect(service).not.toContain("position,bfs_index,registration_id");
  });

  it("persists the authoritative event index in a contract-scoped unique key", () => {
    expect(migration).toContain("contract_address");
    expect(migration).toContain("contract_matrix_index");
    expect(migration).toContain("matrix_placements_contract_index_unique");
    expect(service).toContain("contract_address,contract_matrix_index");
  });

  it("scopes parent slots per deployment while preserving the legacy namespace", () => {
    expect(parentMigration).toContain("DROP CONSTRAINT IF EXISTS matrix_parent_position_unique");
    expect(parentMigration).toContain("matrix_placements_legacy_parent_position_unique");
    expect(parentMigration).toContain("WHERE contract_address IS NULL");
    expect(parentMigration).toContain("matrix_placements_contract_parent_position_unique");
    expect(parentMigration).toContain("contract_address,parent_user_id,position");
    expect(parentMigration).toContain("WHERE contract_address IS NOT NULL");
    expect(parentMigration).not.toMatch(/UPDATE\s+matrix_placements/i);
  });

  it("reports raw PostgreSQL migration diagnostics without connection details", () => {
    expect(runner).toContain('"[database:postgres]"');
    for (const field of ["constraint", "table", "column", "schema", "detail", "routine"]) {
      expect(runner).toContain(`${field}: postgres.${field}`);
    }
    expect(runner).not.toContain("DATABASE_URL:");
  });
});
