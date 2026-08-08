// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(
  resolve("database/migrations/032_aligned_genesis_cap_baseline.sql"), "utf8",
);

async function isolated(assertion: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  const schema = `migration_032_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query("CREATE TABLE users(id uuid PRIMARY KEY,wallet_address varchar(42) UNIQUE NOT NULL)");
    await client.query(`CREATE TABLE user_package_states(
      user_id uuid PRIMARY KEY REFERENCES users(id),registration_value numeric(78,0) NOT NULL,
      total_eligible_value numeric(78,0) NOT NULL,total_earning_cap numeric(78,0) NOT NULL,
      total_earned numeric(78,0) NOT NULL,remaining_cap numeric(78,0) NOT NULL,
      capping_status varchar(16) NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`CREATE TABLE matrix_placements(
      user_id uuid UNIQUE NOT NULL REFERENCES users(id),parent_user_id uuid,contract_address varchar(42))`);
    await client.query(`CREATE TABLE earning_cap_ledger(
      id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
      user_id uuid NOT NULL REFERENCES users(id),
      source_type varchar(40) NOT NULL,source_reference varchar(160) NOT NULL,
      eligible_value numeric(78,0) NOT NULL,cap_increase numeric(78,0) NOT NULL,
      total_cap_after numeric(78,0) NOT NULL,UNIQUE(source_type,source_reference))`);
    await client.query(`CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER earning_cap_ledger_append_only BEFORE UPDATE OR DELETE
      ON earning_cap_ledger FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    await assertion(client);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
}

describe("retired aligned genesis cap baseline on real PostgreSQL", () => {
  afterAll(async () => { await pool.end(); });

  it("does not add registration principal or rewrite legacy ledgers", async () => isolated(async client => {
    const id = randomUUID();
    await client.query("INSERT INTO users VALUES($1,'0xfd314f3a6e47a802a73da6d620ab3114f14d042f')", [id]);
    await client.query(`INSERT INTO user_package_states VALUES(
      $1,2000000,2000000,10000000,10000000,0,'CAPPED',now())`, [id]);
    await client.query("INSERT INTO matrix_placements VALUES($1,NULL,NULL)", [id]);
    await client.query(migration);
    await client.query(migration);
    expect((await client.query(`SELECT total_eligible_value::text eligible,total_earning_cap::text cap,
      total_earned::text earned,remaining_cap::text remaining,capping_status status
      FROM user_package_states WHERE user_id=$1`, [id])).rows[0]).toEqual({
      eligible: "2000000", cap: "10000000", earned: "10000000", remaining: "0", status: "CAPPED",
    });
    expect((await client.query("SELECT count(*)::int count FROM earning_cap_ledger")).rows[0].count).toBe(0);
    await client.query(`INSERT INTO earning_cap_ledger(
      user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
    ) VALUES($1,'PACKAGE_PURCHASE','test:append-only',1,5,5)`, [id]);
    await expect(client.query("UPDATE earning_cap_ledger SET total_cap_after=1"))
      .rejects.toThrow(/append-only/);
  }));

  it("does nothing without a legacy genesis placement", async () => isolated(async client => {
    await client.query(migration);
    expect((await client.query("SELECT count(*)::int count FROM earning_cap_ledger")).rows[0].count).toBe(0);
  }));
});
