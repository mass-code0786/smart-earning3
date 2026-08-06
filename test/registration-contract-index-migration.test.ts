// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("contract-scoped registration matrix index migration", () => {
  const migration = readFileSync(
    resolve("database/migrations/030_contract_scoped_matrix_index.sql"), "utf8",
  );
  const service = readFileSync(resolve("lib/server/registration-service.ts"), "utf8");

  it("preserves the global bfs uniqueness constraint and allocates new database indexes by sequence", () => {
    expect(migration).toContain("matrix_placements_bfs_index_seq");
    expect(migration).toContain("max(bfs_index)");
    expect(migration).not.toContain("DROP CONSTRAINT IF EXISTS matrix_placements_bfs_index_key");
    expect(service).not.toContain("position,bfs_index,registration_id");
  });

  it("persists the authoritative event index in a contract-scoped unique key", () => {
    expect(migration).toContain("contract_address");
    expect(migration).toContain("contract_matrix_index");
    expect(migration).toContain("matrix_placements_contract_index_unique");
    expect(service).toContain("contract_address,contract_matrix_index");
  });
});
