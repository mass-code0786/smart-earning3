// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { reconcileLegacyIndexerCheckpoint } from "@/lib/server/blockchain-indexer";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

describe("authoritative deployment checkpoint recovery on real PostgreSQL", () => {
  afterAll(async () => pool.end());

  it("rewinds a non-null latest-start checkpoint once and remains idempotent", async () => {
    const client = await pool.connect();
    const schema = `checkpoint_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE blockchain_indexer_state(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chain_id integer NOT NULL,
        contract_address varchar(42) NOT NULL,last_processed_block bigint NOT NULL,
        history_start_block bigint,updated_at timestamptz DEFAULT now())`);
      await client.query(`INSERT INTO blockchain_indexer_state(chain_id,contract_address,last_processed_block,history_start_block)
        VALUES(97,'0x1111111111111111111111111111111111111111',5000,5000)`);
      const database = { query: client.query.bind(client) } as never;
      await expect(reconcileLegacyIndexerCheckpoint(97, "0x1111111111111111111111111111111111111111", 999, database))
        .resolves.toEqual({ previousCheckpoint: 5000, checkpoint: 999 });
      await expect(reconcileLegacyIndexerCheckpoint(97, "0x1111111111111111111111111111111111111111", 999, database))
        .resolves.toBeNull();
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});
