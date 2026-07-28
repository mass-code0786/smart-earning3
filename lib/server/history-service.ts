import type { PoolClient } from "pg";

export const APPROVED_HISTORY_CATEGORIES = [
  "PACKAGE", "BOOSTER", "BOOSTER_INCOME", "DIRECT_REFERRAL", "DIRECT_INCOME",
  "MAGIC_LEVEL_INCOME", "X3_INCOME", "X3_RECYCLE", "AUTOPOOL", "DIVIDEND",
  "WITHDRAWAL", "WALLET", "TEAM_PACKAGE_ACTIVITY",
] as const;

export type HistoryCategory = typeof APPROVED_HISTORY_CATEGORIES[number];

export type HistoryWrite = {
  userWallet: string;
  userId?: string | null;
  category: HistoryCategory;
  eventType: string;
  title: string;
  description?: string | null;
  amount?: string | null;
  currency?: string;
  direction?: "CREDIT" | "DEBIT" | "INFO" | null;
  sourceWallet?: string | null;
  sourceUserId?: string | null;
  sponsorWallet?: string | null;
  referralLevel?: number | null;
  packageNumber?: number | null;
  packageAmount?: string | null;
  matrixType?: string | null;
  matrixPackageNumber?: number | null;
  cycleNumber?: number | null;
  recycleNumber?: number | null;
  positionNumber?: number | null;
  previousBalance?: string | null;
  newBalance?: string | null;
  feeAmount?: string | null;
  netAmount?: string | null;
  status: string;
  txHash?: string | null;
  blockNumber?: string | number | null;
  logIndex?: number | null;
  sourceTable: string;
  sourceRecordId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date | string;
};

const normalized = (value?: string | null) => value?.toLowerCase() || null;

export function internalHistoryKey(
  sourceTable: string,
  sourceRecordId: string,
  eventType: string,
  beneficiaryWallet: string,
) {
  return `${sourceTable}:${sourceRecordId}:${eventType}:${beneficiaryWallet.toLowerCase()}`;
}

export function blockchainHistoryKey(
  chainId: number,
  txHash: string,
  logIndex: number,
  eventType: string,
  beneficiaryWallet: string,
) {
  return `${chainId}:${txHash.toLowerCase()}:${logIndex}:${eventType}:${beneficiaryWallet.toLowerCase()}`;
}

export async function recordHistory(client: PoolClient, input: HistoryWrite) {
  if (input.eventType.toUpperCase().includes("X4")) throw new Error("X4 history is not approved");
  const values = [
    normalized(input.userWallet), input.userId || null, input.category, input.eventType, input.title,
    input.description || null, input.amount || null, input.currency || "USDT", input.direction || null,
    normalized(input.sourceWallet), input.sourceUserId || null, normalized(input.sponsorWallet),
    input.referralLevel || null, input.packageNumber || null, input.packageAmount || null,
    input.matrixType || null, input.matrixPackageNumber || null, input.cycleNumber || null,
    input.recycleNumber || null, input.positionNumber || null, input.previousBalance || null,
    input.newBalance || null, input.feeAmount || null, input.netAmount || null, input.status,
    normalized(input.txHash), input.blockNumber || null, input.logIndex ?? null, input.sourceTable,
    input.sourceRecordId, input.idempotencyKey, JSON.stringify(input.metadata || {}), input.occurredAt,
  ];
  const result = await client.query<{ id: string }>(
    `INSERT INTO activity_history(
      user_wallet,user_id,category,event_type,title,description,amount,currency,direction,source_wallet,
      source_user_id,sponsor_wallet,referral_level,package_number,package_amount,matrix_type,
      matrix_package_number,cycle_number,recycle_number,position_number,previous_balance,new_balance,
      fee_amount,net_amount,status,tx_hash,block_number,log_index,source_table,source_record_id,
      idempotency_key,metadata,occurred_at
    ) VALUES(${values.map((_, index) => `$${index + 1}`).join(",")})
    ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    values,
  );
  return { id: result.rows[0]?.id || null, duplicate: !result.rows[0] };
}

export const recordPackageHistory = recordHistory;
export const recordBoosterTopupHistory = recordHistory;
export const recordIncomeHistory = recordHistory;
export const recordReferralHistory = recordHistory;
export const recordMatrixRecycleHistory = recordHistory;
export const recordAutopoolHistory = recordHistory;
export const recordDividendHistory = recordHistory;
export const recordWithdrawalStatusHistory = recordHistory;
