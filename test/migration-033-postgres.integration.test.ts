// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(resolve("database/migrations/033_package_only_earning_cap.sql"), "utf8");

describe("package-only earning-cap reconciliation on real PostgreSQL", () => {
  afterAll(async () => { await pool.end(); });

  it("is idempotent, ignores registration and failed purchases, and preserves historical earnings", async () => {
    const client = await pool.connect();
    const schema = `migration_033_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query("CREATE TABLE users(id uuid PRIMARY KEY)");
      await client.query(`CREATE TABLE user_package_states(
        user_id uuid PRIMARY KEY REFERENCES users(id),total_package_value numeric(78,0) NOT NULL,
        registration_value numeric(78,0) NOT NULL,total_eligible_value numeric(78,0) NOT NULL,
        total_earning_cap numeric(78,0) NOT NULL,total_earned numeric(78,0) NOT NULL,
        remaining_cap numeric(78,0) NOT NULL,capping_status varchar(16) NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(`CREATE TABLE package_purchases(
        id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),amount_token_units numeric(78,0) NOT NULL,
        status varchar(16) NOT NULL)`);
      await client.query(`CREATE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END $$ LANGUAGE plpgsql`);
      const registrationOnly = randomUUID(), packaged = randomUUID(), overCap = randomUUID();
      await client.query("INSERT INTO users VALUES($1),($2),($3)", [registrationOnly, packaged, overCap]);
      await client.query(`INSERT INTO user_package_states VALUES
        ($1,0,2000000,2000000,10000000,0,10000000,'ACTIVE',now()),
        ($2,8000000,2000000,10000000,50000000,5000000,45000000,'ACTIVE',now()),
        ($3,8000000,2000000,10000000,50000000,45000000,5000000,'NEAR_CAP',now())`,
        [registrationOnly, packaged, overCap]);
      await client.query(`INSERT INTO package_purchases VALUES
        ($1,$2,8000000,'CONFIRMED'),($3,$2,16000000,'FAILED'),($4,$5,8000000,'CONFIRMED')`,
        [randomUUID(), packaged, randomUUID(), randomUUID(), overCap]);
      await client.query(migration);
      await client.query(migration);
      const rows = await client.query(`SELECT user_id,total_eligible_value::text eligible,
        total_earning_cap::text cap,total_earned::text earned,remaining_cap::text remaining,capping_status status
        FROM user_package_states ORDER BY user_id`);
      const byId = new Map(rows.rows.map(row => [row.user_id, row]));
      expect(byId.get(registrationOnly)).toMatchObject({ eligible: "0", cap: "0", earned: "0", remaining: "0", status: "CAPPED" });
      expect(byId.get(packaged)).toMatchObject({ eligible: "8000000", cap: "40000000", earned: "5000000", remaining: "35000000", status: "ACTIVE" });
      expect(byId.get(overCap)).toMatchObject({ eligible: "8000000", cap: "40000000", earned: "45000000", remaining: "0", status: "CAPPED" });
      expect((await client.query("SELECT count(*)::int count FROM earning_cap_reconciliations")).rows[0].count).toBe(3);
      expect((await client.query("SELECT historical_excess::text excess FROM earning_cap_reconciliations WHERE user_id=$1", [overCap])).rows[0].excess).toBe("5000000");
      await expect(client.query("DELETE FROM earning_cap_reconciliations")).rejects.toThrow(/append-only/);
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});
