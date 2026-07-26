import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./http";

const POLL_MS = 100;
const LOCK_TIMEOUT_MS = 3_000;

export function sponsorLockName(chainId: number, contract: string, sponsor: string) {
  return `placement:sponsor:${chainId}:${contract.toLowerCase()}:${sponsor.toLowerCase()}`;
}

export function keeperLockName(chainId: number, keeper: string) {
  return `placement:keeper-nonce:${chainId}:${keeper.toLowerCase()}`;
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withPgAdvisoryLock<T>(
  name: string,
  operation: (client: PoolClient) => Promise<T>,
  timeoutMs = LOCK_TIMEOUT_MS,
) {
  const client = await getPool().connect();
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  try {
    while (Date.now() < deadline) {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked",
        [name],
      );
      if (result.rows[0]?.locked) { acquired = true; break; }
      await delay(POLL_MS);
    }
    if (!acquired) {
      throw new ApiError(409, "Placement preparation is busy; retry shortly", "PLACEMENT_LOCK_TIMEOUT");
    }
    return await operation(client);
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [name]);
      } finally { client.release(); }
    } else client.release();
  }
}
