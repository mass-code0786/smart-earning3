import type { PoolClient } from "pg";
import { transaction } from "./db";
import { ApiError } from "./http";

type CreditInput = {
  userId: string;
  incomeType: string;
  sourceReference: string;
  calculatedAmount: bigint;
  idempotencyKey: string;
};

export function calculateCappedCredit(cap: bigint, earned: bigint, calculated: bigint) {
  const remaining = cap > earned ? cap - earned : 0n;
  const credited = calculated > remaining ? remaining : calculated;
  const excess = calculated - credited;
  const totalEarned = earned + credited;
  const remainingAfter = cap - totalEarned;
  const status = remainingAfter === 0n
    ? "CAPPED"
    : totalEarned * 100n >= cap * 90n ? "NEAR_CAP" : "ACTIVE";
  return { credited, excess, totalEarned, remainingAfter, status };
}

export async function creditIncomeWithCap(input: CreditInput, existingClient?: PoolClient) {
  const execute = async (client: PoolClient) => {
    const duplicate = await client.query<{
      id: string;
      credited_amount: string;
      excess_amount: string;
      total_earned_after: string;
    }>(
      `SELECT id,credited_amount::text,excess_amount::text,total_earned_after::text
       FROM income_credit_ledger WHERE idempotency_key=$1`,
      [input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      return {
        credited: BigInt(duplicate.rows[0].credited_amount),
        excess: BigInt(duplicate.rows[0].excess_amount),
        totalEarned: BigInt(duplicate.rows[0].total_earned_after),
        ledgerId: duplicate.rows[0].id,
        duplicate: true,
      };
    }

    const state = await client.query<{
      total_earning_cap: string;
      total_earned: string;
    }>(
      `SELECT total_earning_cap::text,total_earned::text
       FROM user_package_states WHERE user_id=$1 FOR UPDATE`,
      [input.userId],
    );
    if (!state.rows[0]) throw new ApiError(409, "User cap state is not initialized", "CAP_STATE_MISSING");

    const cap = BigInt(state.rows[0].total_earning_cap);
    const earned = BigInt(state.rows[0].total_earned);
    const { credited, excess, totalEarned, remainingAfter, status } =
      calculateCappedCredit(cap, earned, input.calculatedAmount);

    const ledger = await client.query<{id:string}>(
      `INSERT INTO income_credit_ledger(
         user_id,income_type,source_reference,calculated_amount,credited_amount,
         excess_amount,total_earned_after,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.userId, input.incomeType, input.sourceReference,
        input.calculatedAmount.toString(), credited.toString(), excess.toString(),
        totalEarned.toString(), input.idempotencyKey,
      ],
    );
    if (excess > 0n) {
      await client.query(
        `INSERT INTO capped_excess_ledger(
           user_id,income_type,source_reference,calculated_amount,credited_amount,excess_amount
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          input.userId, input.incomeType, input.sourceReference,
          input.calculatedAmount.toString(), credited.toString(), excess.toString(),
        ],
      );
    }
    await client.query(
      `UPDATE user_package_states SET total_earned=$2,remaining_cap=$3,
       capping_status=$4,updated_at=now() WHERE user_id=$1`,
      [input.userId, totalEarned.toString(), remainingAfter.toString(), status],
    );
    return { credited, excess, totalEarned, ledgerId: ledger.rows[0].id, duplicate: false };
  };
  return existingClient ? execute(existingClient) : transaction(execute);
}
