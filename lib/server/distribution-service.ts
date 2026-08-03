import { Contract, Interface, Wallet } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { getServerConfig } from "./config";
import { getPool, query, transaction } from "./db";
import { ApiError } from "./http";
import { creditGrossEarning } from "./earning-split-service";
import { getMagicDistributionConfig, isMagicDistributionDue } from "./magic-distribution-config";

const iface = new Interface(SMART_EARNING_ABI);

export async function withDistributionWorkerLock<T>(fn: () => Promise<T>) {
  const client = await getPool().connect();
  const locked = (await client.query<{ ok: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext('magic-distribution:worker')) ok",
  )).rows[0].ok;
  if (!locked) { client.release(); return null; }
  try { return await fn(); }
  finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('magic-distribution:worker'))");
    client.release();
  }
}

type Allocation = {
  source: string;
  beneficiary: string;
  level: number;
  amount: bigint;
  qualified: boolean;
};

export function hasRequiredMagicBalance(balance: string, requiredBalance: string | null) {
  return requiredBalance !== null && BigInt(balance) >= BigInt(requiredBalance);
}

export async function runMagicDistributionScheduler(
  now = new Date(),
  run: typeof runDistributionCycle = runDistributionCycle,
) {
  const config = getMagicDistributionConfig();
  if (!isMagicDistributionDue(now, config)) {
    return {
      status: "SCHEDULE_WAIT" as const,
      processed: 0,
      failed: 0,
      scheduledHour: config.hour,
      scheduledMinute: config.minute,
    };
  }
  return run();
}

export async function runDistributionCycle() {
  const config = getServerConfig();
  if (!config.KEEPER_PRIVATE_KEY) {
    throw new ApiError(503, "Keeper key is not configured", "KEEPER_NOT_CONFIGURED");
  }
  const provider = getProvider();
  const signer = new Wallet(config.KEEPER_PRIVATE_KEY, provider);
  const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, signer);
  const cycleId = BigInt(await contract.currentCycle());
  const cycleDate = new Date(Number(cycleId) * 86_400_000).toISOString().slice(0, 10);

  const cycle = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`distribution:${cycleId}`]);
    const result = await client.query<{ id: string; status: string }>(
      `INSERT INTO distribution_cycles(chain_cycle_id,cycle_date,status,started_at)
       VALUES($1,$2,'RUNNING',now())
       ON CONFLICT(cycle_date) DO UPDATE SET
         status=CASE WHEN distribution_cycles.status='COMPLETED' THEN 'COMPLETED' ELSE 'RUNNING' END,
         started_at=COALESCE(distribution_cycles.started_at,now())
       RETURNING id,status`,
      [cycleId.toString(), cycleDate],
    );
    return result.rows[0];
  });
  if (cycle.status === "COMPLETED") return { cycleId: cycleId.toString(), alreadyComplete: true };

  const candidates = await query<{ id: string; wallet_address: string; balance: string; requiredBalance: string | null }>(
    `SELECT u.id,u.wallet_address,
       COALESCE((SELECT sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END)
                 FROM magic_wallet_ledger l WHERE l.user_id=u.id),0)::text balance,
       (SELECT amount_token_units::text FROM magic_wallet_ledger WHERE reason='REGISTRATION_CREDIT' ORDER BY created_at,id LIMIT 1) "requiredBalance"
     FROM users u
     WHERE u.status='ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM magic_wallet_ledger l
         WHERE l.user_id=u.id AND l.distribution_cycle_id=$1 AND l.reason='DAILY_DISTRIBUTION'
       )
     ORDER BY u.created_at`,
    [cycle.id],
  );
  const eligible = candidates.rows.filter(row => hasRequiredMagicBalance(row.balance, row.requiredBalance));
  const skipped = candidates.rows.length - eligible.length;
  await query("UPDATE distribution_cycles SET eligible_users=$2 WHERE id=$1", [
    cycle.id,
    eligible.length,
  ]);

  let processed = 0;
  let failed = 0;
  const hashes: string[] = [];
  for (let offset = 0; offset < eligible.length; offset += 50) {
    const batch = eligible.slice(offset, offset + 50);
    try {
      const sent = await contract.distributeBatch(
        batch.map((row) => row.wallet_address),
        cycleId,
      );
      const receipt = await sent.wait(config.CONFIRMATIONS_REQUIRED);
      hashes.push(receipt.hash);
      const allocations: Allocation[] = [];
      for (const log of receipt.logs) {
        try {
          const event = iface.parseLog(log);
          if (event?.name === "MagicLevelAllocated") {
            allocations.push({
              source: String(event.args.source).toLowerCase(),
              beneficiary: String(event.args.beneficiary).toLowerCase(),
              level: Number(event.args.level),
              amount: BigInt(event.args.amount),
              qualified: Boolean(event.args.qualified),
            });
          }
        } catch {
          // Ignore USDT logs.
        }
      }
      await recordDistribution(cycle.id, receipt.hash, batch, allocations);
      processed += batch.length;
    } catch (error) {
      console.error("Distribution batch failed", error);
      failed += batch.length;
    }
  }

  const status = failed === 0 ? "COMPLETED" : processed ? "PARTIAL" : "FAILED";
  await query(
    `UPDATE distribution_cycles SET status=$2,processed_users=$3,failed_users=$4,
       tx_hash=$5,completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END
     WHERE id=$1`,
    [cycle.id, status, processed, failed, hashes.at(-1) || null],
  );
  return { cycleId: cycleId.toString(), processed, skipped, failed, hashes, status };
}

async function recordDistribution(
  cycleId: string,
  txHash: string,
  users: { id: string; wallet_address: string }[],
  allocations: Allocation[],
) {
  await transaction(async (client) => {
    const ids = new Map(users.map((user) => [user.wallet_address, user.id]));
    const beneficiaryWallets = [...new Set(allocations.map((x) => x.beneficiary))]
      .filter((wallet) => wallet !== "0x0000000000000000000000000000000000000000");
    if (beneficiaryWallets.length) {
      const result = await client.query<{ id: string; wallet_address: string }>(
        "SELECT id,wallet_address FROM users WHERE wallet_address=ANY($1::varchar[])",
        [beneficiaryWallets],
      );
      for (const row of result.rows) ids.set(row.wallet_address, row.id);
    }

    const totals = new Map<string, bigint>();
    for (const allocation of allocations) {
      const sourceId = ids.get(allocation.source);
      if (!sourceId) throw new Error(`Missing indexed source ${allocation.source}`);
      const beneficiaryId = ids.get(allocation.beneficiary) || null;
      const status = allocation.beneficiary === "0x0000000000000000000000000000000000000000"
        ? "PENDING_NO_UPLINE"
        : allocation.qualified ? "CLAIMABLE" : "PENDING_UNQUALIFIED";
      if (allocation.qualified && beneficiaryId) {
        const capped = await creditGrossEarning({
          userId: beneficiaryId,
          incomeType: "MAGIC_LEVEL_INCOME",
          sourceReference: `${cycleId}:${allocation.source}:${allocation.level}`,
          grossAmount: 50_000n,
          idempotencyKey: `distribution:${cycleId}:${allocation.source}:${allocation.level}:cap`,
          magicAlreadyOnchain:true,
        }, client);
        if (capped.credited !== allocation.amount) {
          throw new ApiError(409, "On-chain and indexed Magic cap disagree", "CAP_RECONCILIATION_FAILED");
        }
      }
      if (allocation.amount > 0n) await client.query(
        `INSERT INTO magic_income_ledger(
          beneficiary_user_id,source_user_id,distribution_cycle_id,matrix_level,
          amount_token_units,qualified,status,idempotency_key
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(idempotency_key) DO NOTHING`,
        [
          beneficiaryId,
          sourceId,
          cycleId,
          allocation.level,
          allocation.amount.toString(),
          allocation.qualified,
          status,
          `distribution:${cycleId}:${allocation.source}:${allocation.level}`,
        ],
      );
      const outcome=allocation.beneficiary === "0x0000000000000000000000000000000000000000"
        ?"MISSING_UPLINE":!allocation.qualified?"UNQUALIFIED":allocation.amount<50_000n?"CAPPED":"CREDITED";
      await client.query(`INSERT INTO magic_distribution_level_outcomes(
        distribution_cycle_id,source_user_id,level_number,classified_amount,outcome,credited_amount,idempotency_key
      ) VALUES($1,$2,$3,50000,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING`,
      [cycleId,sourceId,allocation.level,outcome,allocation.amount.toString(),
        `distribution:outcome:${cycleId}:${allocation.source}:${allocation.level}`]);
      totals.set(sourceId, 1_000_000n);
    }
    for (const [userId, amount] of totals) {
      await client.query(
        `INSERT INTO magic_wallet_ledger(
          user_id,distribution_cycle_id,direction,amount_token_units,reason,idempotency_key,metadata
        ) VALUES($1,$2,'DEBIT',$3,'DAILY_DISTRIBUTION',$4,$5)
        ON CONFLICT(idempotency_key) DO NOTHING`,
        [userId, cycleId, amount.toString(), `distribution:${cycleId}:${userId}:debit`, JSON.stringify({ txHash })],
      );
    }
  });
}
