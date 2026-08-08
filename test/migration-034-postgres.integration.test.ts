// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(resolve("database/migrations/034_registration_cap_not_applicable.sql"), "utf8");

describe("registration-only cap state on real PostgreSQL", () => {
  afterAll(async () => pool.end());

  it("marks zero-package users not applicable and enforces package-only 5x state", async () => {
    const client = await pool.connect();
    const schema = `migration_034_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE user_package_states(
        user_id uuid PRIMARY KEY,total_package_value numeric(78,0) NOT NULL,
        total_eligible_value numeric(78,0) NOT NULL,total_earning_cap numeric(78,0) NOT NULL,
        total_earned numeric(78,0) NOT NULL,remaining_cap numeric(78,0) NOT NULL,
        capping_status varchar(16) NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_package_states_capping_status_check CHECK(capping_status IN('ACTIVE','NEAR_CAP','CAPPED')))`);
      const registrationOnly = randomUUID(), packaged = randomUUID();
      await client.query(`INSERT INTO user_package_states VALUES
        ($1,0,0,0,0,0,'CAPPED',now()),($2,8000000,8000000,40000000,0,40000000,'ACTIVE',now())`,
        [registrationOnly, packaged]);
      await client.query(migration);
      expect((await client.query("SELECT capping_status FROM user_package_states WHERE user_id=$1", [registrationOnly])).rows[0].capping_status)
        .toBe("NOT_APPLICABLE");
      await expect(client.query(`UPDATE user_package_states SET total_earning_cap=10000000 WHERE user_id=$1`, [registrationOnly]))
        .rejects.toThrow();
      await expect(client.query(`UPDATE user_package_states SET total_earning_cap=41000000 WHERE user_id=$1`, [packaged]))
        .rejects.toThrow();
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});
