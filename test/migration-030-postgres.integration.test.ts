// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(
  resolve("database/migrations/030_contract_scoped_matrix_index.sql"), "utf8",
);

async function fixture(client: PoolClient, legacy: boolean) {
  await client.query(`CREATE TABLE matrix_placements(
      id bigserial PRIMARY KEY,
    bfs_index bigint NOT NULL UNIQUE
  )`);
  await client.query(`CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END $$ LANGUAGE plpgsql`);
  await client.query(`CREATE TRIGGER matrix_placements_immutable
    BEFORE UPDATE OR DELETE ON matrix_placements
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
  if (legacy) await client.query("INSERT INTO matrix_placements(bfs_index) VALUES(1)");
}

async function isolated(
  setup: (client: PoolClient) => Promise<void>,
  assertion: (client: PoolClient) => Promise<void>,
) {
  const client = await pool.connect();
  const schema = `migration_030_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await setup(client);
    await assertion(client);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
}

describe("migration 030 on real PostgreSQL", () => {
  afterAll(async () => { await pool.end(); });

  it("migrates a fresh table and is safely rerunnable", async () => isolated(
    client => fixture(client, false),
    async client => {
      await client.query(migration);
      await client.query(migration);
      await client.query("INSERT INTO matrix_placements(bfs_index) VALUES(0)");
      const aligned = (await client.query<{ bfs_index: string }>(
        `INSERT INTO matrix_placements(contract_address,contract_matrix_index)
         VALUES('0x1111111111111111111111111111111111111111',1)
         RETURNING bfs_index::text`,
      )).rows[0];
      expect(aligned.bfs_index).toBe("1");
    },
  ));

  it("preserves legacy bfs_index 1 and leaves append-only rows unchanged", async () => isolated(
    client => fixture(client, true),
    async client => {
      await client.query(migration);
      const aligned = (await client.query<{ bfs_index: string }>(
        `INSERT INTO matrix_placements(contract_address,contract_matrix_index)
         VALUES('0x2222222222222222222222222222222222222222',1)
         RETURNING bfs_index::text`,
      )).rows[0];
      expect(aligned.bfs_index).toBe("2");
      expect((await client.query(
        "SELECT 1 FROM matrix_placements WHERE bfs_index=1 AND contract_address IS NULL",
      )).rowCount).toBe(1);
      await expect(client.query(
        "UPDATE matrix_placements SET contract_address='0x3333333333333333333333333333333333333333' WHERE bfs_index=1",
      )).rejects.toThrow(/append-only/);
    },
  ));

  it("recovers a production-like partially applied schema", async () => isolated(
    client => fixture(client, true),
    async client => {
      await client.query("CREATE SEQUENCE matrix_placements_bfs_index_seq AS bigint");
      await client.query("SELECT setval('matrix_placements_bfs_index_seq',60,false)");
      await client.query(`ALTER TABLE matrix_placements
        ALTER COLUMN bfs_index SET DEFAULT nextval('matrix_placements_bfs_index_seq'),
        ADD COLUMN contract_address varchar(42),
        ADD COLUMN contract_matrix_index numeric(78,0)`);
      await client.query(migration);
      await client.query(migration);
      const aligned = (await client.query<{ bfs_index: string }>(
        `INSERT INTO matrix_placements(contract_address,contract_matrix_index)
         VALUES('0x4444444444444444444444444444444444444444',1)
         RETURNING bfs_index::text`,
      )).rows[0];
      expect(aligned.bfs_index).toBe("60");
      await expect(client.query(
        "UPDATE matrix_placements SET contract_matrix_index=2 WHERE bfs_index=1",
      )).rejects.toThrow(/append-only/);
    },
  ));
});
