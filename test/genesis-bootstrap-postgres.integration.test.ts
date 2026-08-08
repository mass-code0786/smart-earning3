// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { bootstrapGenesis } from "@/lib/server/genesis-bootstrap";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const genesis = "0xfd314f3A6E47a802A73da6d620ab3114f14d042F";

async function fixture(client: PoolClient) {
  await client.query(`CREATE TABLE users(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_address varchar(42) UNIQUE NOT NULL,
    status varchar(16) NOT NULL,role varchar(16) NOT NULL,activated_at timestamptz)`);
  await client.query(`CREATE TABLE matrix_placements(
    user_id uuid UNIQUE NOT NULL REFERENCES users(id),parent_user_id uuid,position smallint,
    bfs_index bigint UNIQUE NOT NULL,contract_address varchar(42))`);
  await client.query(`CREATE TABLE user_package_states(
    user_id uuid PRIMARY KEY REFERENCES users(id),registration_value numeric(78,0) NOT NULL,
    total_eligible_value numeric(78,0) NOT NULL,total_earning_cap numeric(78,0) NOT NULL,
    total_earned numeric(78,0) NOT NULL,remaining_cap numeric(78,0) NOT NULL,
    capping_status varchar(16) NOT NULL)`);
  await client.query(`CREATE TABLE earning_cap_ledger(
    user_id uuid NOT NULL REFERENCES users(id),source_type varchar(40) NOT NULL,
    source_reference varchar(160) NOT NULL,eligible_value numeric(78,0) NOT NULL,
    cap_increase numeric(78,0) NOT NULL,total_cap_after numeric(78,0) NOT NULL,
    UNIQUE(source_type,source_reference))`);
  await client.query("CREATE TABLE registrations(id uuid)");
  await client.query("CREATE TABLE referral_relations(id uuid)");
  await client.query("CREATE TABLE package_purchases(id uuid)");
  await client.query("CREATE TABLE income_credit_ledger(id uuid)");
}

async function isolated(assertion: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  const schema = `genesis_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema},public`);
    await fixture(client);
    await assertion(client);
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
}

describe("Genesis sponsor bootstrap on real PostgreSQL", () => {
  afterAll(async () => { await pool.end(); });

  it("creates the constructor projection once and remains idempotent", async () => isolated(async client => {
    const first = await bootstrapGenesis(client, genesis, 2_000_000n);
    const second = await bootstrapGenesis(client, genesis.toLowerCase(), 2_000_000n);
    expect(first.createdUser).toBe(true);
    expect(second).toMatchObject({ createdUser: false, wallet: genesis.toLowerCase(), status: "ACTIVE" });

    for (const table of ["users", "matrix_placements", "user_package_states"]) {
      expect(Number((await client.query(`SELECT count(*) count FROM ${table}`)).rows[0].count)).toBe(1);
    }
    for (const table of ["earning_cap_ledger", "registrations", "referral_relations", "package_purchases", "income_credit_ledger"]) {
      expect(Number((await client.query(`SELECT count(*) count FROM ${table}`)).rows[0].count)).toBe(0);
    }
    expect((await client.query(`SELECT total_eligible_value::text eligible,total_earning_cap::text cap,
      remaining_cap::text remaining,capping_status status FROM user_package_states`)).rows[0]).toEqual({
      eligible: "0", cap: "0", remaining: "0", status: "NOT_APPLICABLE",
    });
    expect((await client.query(
      "SELECT status,role,activated_at IS NOT NULL activated FROM users WHERE wallet_address=$1",
      [genesis.toLowerCase()],
    )).rows[0]).toMatchObject({ status: "ACTIVE", role: "ADMIN", activated: true });
  }));

  it("refuses to replace a different database root", async () => isolated(async client => {
    const other = "0x1111111111111111111111111111111111111111";
    const id = (await client.query(
      "INSERT INTO users(wallet_address,status,role,activated_at) VALUES($1,'ACTIVE','USER',now()) RETURNING id",
      [other],
    )).rows[0].id;
    await client.query("INSERT INTO matrix_placements(user_id,bfs_index) VALUES($1,0)", [id]);
    await expect(bootstrapGenesis(client, genesis, 2_000_000n)).rejects.toThrow(/database root/);
    expect((await client.query("SELECT count(*)::int count FROM users")).rows[0].count).toBe(1);
  }));
});
