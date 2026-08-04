import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, transaction } from "./db";

export const X3_HOLD_DURATION_MS = 48 * 60 * 60 * 1000;
export type X3HoldTrigger = "WORKER" | "PACKAGE";

export function x3HoldExpiresAt(heldAt: Date) {
  return new Date(heldAt.getTime() + X3_HOLD_DURATION_MS);
}

export function isX3HoldReleaseEligible(upgradeTimestamp: Date, expiresAt: Date | null) {
  return expiresAt === null || upgradeTimestamp.getTime() < expiresAt.getTime();
}

export async function flushLockedX3Hold(
  client: PoolClient,
  hold: { id:string; user_id:string; package_id:number; x3_income_ledger_id:string; amount:string; held_at:Date; expires_at:Date },
  trigger: X3HoldTrigger,
  workerInstance: string | null = null,
) {
  const updated = await client.query<{flushed_at:Date}>(
    `UPDATE x3_hold_ledger SET status='FLUSHED',flushed_at=GREATEST(transaction_timestamp(),expires_at)
     WHERE id=$1 AND status='HELD' AND expires_at IS NOT NULL
     RETURNING flushed_at`,
    [hold.id],
  );
  if (!updated.rows[0]) return false;
  await client.query(
    `UPDATE x3_income_ledger SET status='FLUSHED'
     WHERE id=$1 AND status='HELD'`,
    [hold.x3_income_ledger_id],
  );
  await client.query(
    `INSERT INTO x3_hold_expiry_history(
       hold_id,user_id,package_id,amount,held_at,expires_at,flushed_at,
       trigger_type,worker_instance,idempotency_key
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(hold_id) DO NOTHING`,
    [hold.id,hold.user_id,hold.package_id,hold.amount,hold.held_at,hold.expires_at,
      updated.rows[0].flushed_at,trigger,workerInstance,`x3:hold-flush:${hold.id}`],
  );
  return true;
}

async function flushDueBatch(limit:number,workerInstance:string) {
  return transaction(async client => {
    const holds = await client.query<{
      id:string;user_id:string;package_id:number;x3_income_ledger_id:string;
      amount:string;held_at:Date;expires_at:Date;
    }>(
      `SELECT id,user_id,package_id,x3_income_ledger_id,amount::text,held_at,expires_at
       FROM x3_hold_ledger
       WHERE status='HELD' AND expires_at IS NOT NULL
         AND expires_at<=transaction_timestamp()
       ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1`,
      [limit],
    );
    let flushed=0;
    for (const hold of holds.rows) {
      if (await flushLockedX3Hold(client,hold,"WORKER",workerInstance)) flushed++;
    }
    return { selected:holds.rows.length,flushed };
  });
}

export async function runX3HoldExpiryScheduler(limit=100) {
  const safeLimit=Math.max(1,Math.min(500,limit));
  const workerInstance=`x3-hold-expiry-${process.pid}-${randomUUID().slice(0,8)}`;
  let selected=0,flushed=0,batches=0;
  do {
    const result=await flushDueBatch(safeLimit,workerInstance);
    selected=result.selected;flushed+=result.flushed;batches++;
  } while(selected===safeLimit&&batches<100);
  return { flushed,batches,workerInstance };
}

export async function withX3HoldExpiryWorkerLock<T>(operation:()=>Promise<T>) {
  const client=await getPool().connect();
  const locked=(await client.query<{ok:boolean}>(
    "SELECT pg_try_advisory_lock(hashtext('x3:hold-expiry:worker')) ok",
  )).rows[0].ok;
  if(!locked){client.release();return null;}
  try{return await operation();}
  finally{await client.query("SELECT pg_advisory_unlock(hashtext('x3:hold-expiry:worker'))");client.release();}
}
