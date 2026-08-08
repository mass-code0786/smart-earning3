// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const migration = readFileSync(resolve(
  "database/migrations/035_contract_scoped_x3_direct_rollout.sql",
), "utf8");

describe("contract-scoped direct X3 rollout migration on PostgreSQL", () => {
  afterAll(async () => pool.end());

  it("preserves a legacy boundary, aligns the current deployment, and is rerunnable", async () => {
    const client = await pool.connect();
    const schema = `migration_035_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE x3_direct_rollout(
        singleton boolean PRIMARY KEY,boundary_block_number bigint NOT NULL,
        boundary_log_index integer NOT NULL,mode varchar(24) NOT NULL)`);
      await client.query("INSERT INTO x3_direct_rollout VALUES(true,999,4,'TRANSITIONAL')");
      await client.query(migration);
      await client.query(migration);

      expect((await client.query("SELECT * FROM x3_direct_rollout")).rows[0]).toMatchObject({
        boundary_block_number: "999", boundary_log_index: 4, mode: "TRANSITIONAL",
      });
      const current = (await client.query(
        "SELECT * FROM x3_direct_deployment_rollouts WHERE chain_id=97",
      )).rows[0];
      expect(current).toMatchObject({
        contract_address: "0xe8849043da1b0105f13cbdade8471d82e1847876",
        deployment_block: "123687054", boundary_block_number: "123687053",
        boundary_log_index: -1, mode: "CONTRACT_ALIGNED",
      });
      expect((await client.query("SELECT count(*)::int n FROM x3_direct_deployment_rollouts")).rows[0].n)
        .toBe(1);
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});
