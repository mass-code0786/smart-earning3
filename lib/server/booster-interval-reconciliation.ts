import type { PoolClient } from "pg";
import { getPool } from "./db";

export type BoosterIntervalExample = {
  userId: string;
  wallet: string;
  lastEntryAt: string;
  beforeNextEntryAt: string;
  afterNextEntryAt: string;
};

export type BoosterIntervalReconciliation = {
  dryRun: boolean;
  affectedRows: number;
  examples: BoosterIntervalExample[];
};

const candidatesSql = `
  SELECT m.user_id,u.wallet_address,m.last_entry_at,m.next_entry_at,
    GREATEST(m.last_entry_at+interval '4 hours',transaction_timestamp()) corrected_next_entry_at
  FROM booster_memberships m
  JOIN users u ON u.id=m.user_id
  WHERE m.last_entry_at IS NOT NULL
    AND m.next_entry_at=m.last_entry_at+interval '5 hours'`;

function result(rows: Array<{
  user_id: string; wallet_address: string; last_entry_at: Date | string;
  next_entry_at: Date | string; corrected_next_entry_at: Date | string;
}>, dryRun: boolean): BoosterIntervalReconciliation {
  return {
    dryRun,
    affectedRows: rows.length,
    examples: rows.slice(0, 10).map(row => ({
      userId: row.user_id,
      wallet: row.wallet_address,
      lastEntryAt: new Date(row.last_entry_at).toISOString(),
      beforeNextEntryAt: new Date(row.next_entry_at).toISOString(),
      afterNextEntryAt: new Date(row.corrected_next_entry_at).toISOString(),
    })),
  };
}

export async function reconcileLegacyBoosterInterval(
  dryRun = true,
  existingClient?: Pick<PoolClient, "query">,
): Promise<BoosterIntervalReconciliation> {
  if (dryRun) {
    const client = existingClient || getPool();
    const rows = (await client.query(`${candidatesSql} ORDER BY m.next_entry_at,m.user_id`)).rows;
    return result(rows, true);
  }

  const ownedClient = existingClient ? null : await getPool().connect();
  const client = existingClient || ownedClient!;
  try {
    if (ownedClient) await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('booster:interval-reconciliation:4h'))");
    const rows = (await client.query(`
      WITH candidates AS MATERIALIZED (${candidatesSql} FOR UPDATE OF m),
      updated AS (
        UPDATE booster_memberships m
        SET next_entry_at=c.corrected_next_entry_at,updated_at=transaction_timestamp()
        FROM candidates c
        WHERE m.user_id=c.user_id
          AND m.next_entry_at=c.next_entry_at
        RETURNING m.user_id,c.wallet_address,c.last_entry_at,c.next_entry_at,c.corrected_next_entry_at
      )
      SELECT * FROM updated ORDER BY next_entry_at,user_id`)).rows;
    if (ownedClient) await client.query("COMMIT");
    return result(rows, false);
  } catch (error) {
    if (ownedClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    ownedClient?.release();
  }
}
