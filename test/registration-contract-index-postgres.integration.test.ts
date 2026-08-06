// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPool, transaction } from "@/lib/server/db";
import { reconcileExistingRegistrationProjection } from "@/lib/server/registration-service";

const pool = getPool();
const wallet = (suffix: number) => `0x${suffix.toString(16).padStart(40, "0")}`;

describe("contract-scoped registration matrix indexes", () => {
  afterAll(async () => { await pool.end(); });

  it("projects contract index 1 beside legacy bfs_index 1 and remains idempotent", async () => {
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      const seed = Date.now() % 1_000_000;
      const sponsorWallet = wallet(seed + 10);
      const childWallet = wallet(seed + 11);
      const legacyWallet = wallet(seed + 12);
      const contractAddress = wallet(seed + 13);
      const users = await Promise.all([sponsorWallet, childWallet, legacyWallet].map(async address =>
        (await client.query<{ id: string }>(
          "INSERT INTO users(wallet_address,status,activated_at) VALUES($1,'ACTIVE',now()) RETURNING id",
          [address],
        )).rows[0].id));
      await client.query(
        `INSERT INTO matrix_placements(user_id,parent_user_id,position,bfs_index)
         VALUES($1,NULL,NULL,1) ON CONFLICT(bfs_index) DO NOTHING`,
        [users[2]],
      );
      const registration = (await client.query<{ id: string }>(
        `INSERT INTO registrations(user_id,sponsor_user_id,tx_hash,chain_id,amount_token_units,status,block_number,confirmed_at)
         VALUES($1,$2,$3,97,2000000,'CONFIRMED',123,now()) RETURNING id`,
        [users[1], users[0], `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}`],
      )).rows[0];
      const input = {
        registrationId: registration.id, status: "CONFIRMED", userId: users[1],
        sponsorUserId: users[0], wallet: childWallet, sponsor: sponsorWallet,
        txHash: `0x${"12".repeat(32)}`, blockNumber: 123, confirmedAt: new Date(),
        matrixParent: sponsorWallet, matrixIndex: 1n, matrixPosition: 0,
        contractAddress, logIndex: 1,
      };

      expect((await reconcileExistingRegistrationProjection(client, input)).placementCreated).toBe(true);
      expect((await reconcileExistingRegistrationProjection(client, input)).placementCreated).toBe(false);
      const placement = (await client.query<{
        bfs_index: string; contract_matrix_index: string; contract_address: string;
      }>(
        `SELECT bfs_index::text,contract_matrix_index::text,contract_address
         FROM matrix_placements WHERE user_id=$1`,
        [users[1]],
      )).rows[0];
      expect(placement).toMatchObject({ contract_matrix_index: "1", contract_address: contractAddress });
      expect(placement.bfs_index).not.toBe("1");
      expect((await client.query(
        "SELECT 1 FROM matrix_placements WHERE user_id=$1", [users[1]],
      )).rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 30_000);

  it("rolls back preceding rows when a contract placement constraint fails", async () => {
    const failedWallet = wallet((Date.now() % 1_000_000) + 100);
    const anchorWallet = wallet((Date.now() % 1_000_000) + 101);
    const contractAddress = wallet((Date.now() % 1_000_000) + 102);
    await expect(transaction(async client => {
      const anchor = (await client.query<{ id: string }>(
        "INSERT INTO users(wallet_address,status) VALUES($1,'ACTIVE') RETURNING id", [anchorWallet],
      )).rows[0];
      await client.query(
        `INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address,contract_matrix_index)
         VALUES($1,NULL,NULL,$2,1)`, [anchor.id, contractAddress],
      );
      const user = (await client.query<{ id: string }>(
        "INSERT INTO users(wallet_address,status) VALUES($1,'ACTIVE') RETURNING id", [failedWallet],
      )).rows[0];
      await client.query(
        `INSERT INTO matrix_placements(user_id,parent_user_id,position,contract_address,contract_matrix_index)
         VALUES($1,NULL,NULL,$2,1)`, [user.id, contractAddress],
      );
    })).rejects.toThrow();
    expect((await pool.query("SELECT 1 FROM users WHERE wallet_address=$1", [failedWallet])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM users WHERE wallet_address=$1", [anchorWallet])).rowCount).toBe(0);
  }, 30_000);
});
