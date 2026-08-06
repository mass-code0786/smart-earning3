// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(
  resolve("database/migrations/031_contract_scoped_matrix_parent_position.sql"), "utf8",
);
const legacyContract = null;
const alignedContract = "0xf2f759f3916f18c12ac5289fe73e79fd68500f8c";

async function isolated(assertion: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  const schema = `migration_031_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE matrix_placements(
      id bigserial PRIMARY KEY,
      user_id bigint NOT NULL UNIQUE,
      parent_user_id bigint,
      position smallint,
      contract_address varchar(42),
      CONSTRAINT matrix_parent_position_unique UNIQUE(parent_user_id,position)
    )`);
    await client.query(`CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER matrix_placements_immutable
      BEFORE UPDATE OR DELETE ON matrix_placements
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    await assertion(client);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
}

describe("migration 031 on real PostgreSQL", () => {
  afterAll(async () => { await pool.end(); });

  it("allows a legacy and aligned deployment to occupy the same parent slot", async () => isolated(async client => {
    await client.query(
      "INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES(2,1,0,$1)",
      [legacyContract],
    );
    await client.query(migration);
    await client.query(migration);
    await client.query(
      "INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES(3,1,0,$1)",
      [alignedContract],
    );
    await expect(client.query(
      "INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES(4,1,0,$1)",
      [alignedContract],
    )).rejects.toMatchObject({ code: "23505", constraint: "matrix_placements_contract_parent_position_unique" });
    expect((await client.query("SELECT 1 FROM matrix_placements WHERE parent_user_id=1 AND position=0")).rowCount).toBe(2);
  }));

  it("keeps legacy uniqueness and append-only protection enabled", async () => isolated(async client => {
    await client.query(
      "INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES(2,1,0,NULL)",
    );
    await client.query(migration);
    await expect(client.query(
      "INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES(3,1,0,NULL)",
    )).rejects.toMatchObject({ code: "23505", constraint: "matrix_placements_legacy_parent_position_unique" });
    await expect(client.query(
      "UPDATE matrix_placements SET position=1 WHERE user_id=2",
    )).rejects.toThrow(/append-only/);
    const trigger = (await client.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname='matrix_placements_immutable'",
    )).rows[0];
    expect(trigger.tgenabled).toBe("O");
  }));

  it("scopes recursive traversal to one deployment", async () => isolated(async client => {
    await client.query(migration);
    await client.query(`INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address) VALUES
      (2,1,0,NULL),(3,1,0,$1),(4,2,0,NULL),(5,3,0,$1)`, [alignedContract]);
    const result = await client.query<{ user_id: string }>(`WITH RECURSIVE descendants AS (
      SELECT p.* FROM matrix_placements p
      WHERE p.parent_user_id=1 AND p.contract_address=$1
      UNION ALL
      SELECT child.* FROM descendants parent JOIN matrix_placements child
        ON child.parent_user_id=parent.user_id
       AND child.contract_address=parent.contract_address
    ) SELECT user_id::text FROM descendants ORDER BY user_id`, [alignedContract]);
    expect(result.rows.map(row => row.user_id)).toEqual(["3", "5"]);
  }));
});
