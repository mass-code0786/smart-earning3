import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";
import { APPROVED_HISTORY_CATEGORIES, type HistoryCategory } from "./history-service";

export type HistoryFilters = {
  category?: string | null;
  eventType?: string | null;
  status?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  sourceWallet?: string | null;
  txHash?: string | null;
  packageNumber?: number | null;
  cursor?: string | null;
  limit?: number;
};

type Cursor = { occurredAt: string; id: string };
function decodeCursor(value?: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed.id || Number.isNaN(Date.parse(parsed.occurredAt))) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid history cursor", "INVALID_CURSOR");
  }
}
function encodeCursor(item: { occurred_at: Date | string; id: string }) {
  return Buffer.from(JSON.stringify({
    occurredAt: new Date(item.occurred_at).toISOString(), id: item.id,
  })).toString("base64url");
}
function optionalDate(value: string | null | undefined, end = false) {
  if (!value) return null;
  const date = new Date(end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "Invalid history date", "INVALID_DATE");
  return date;
}

export async function getHistory(walletInput: string, filters: HistoryFilters = {}) {
  const wallet = normalizeWallet(walletInput);
  const category = filters.category?.trim().toUpperCase() || null;
  if (category && !APPROVED_HISTORY_CATEGORIES.includes(category as HistoryCategory)) {
    throw new ApiError(400, "Invalid history category", "INVALID_CATEGORY");
  }
  const sourceWallet = filters.sourceWallet ? normalizeWallet(filters.sourceWallet) : null;
  const packageNumber = filters.packageNumber == null ? null : Number(filters.packageNumber);
  if (packageNumber !== null && (!Number.isInteger(packageNumber) || packageNumber < 1)) {
    throw new ApiError(400, "Invalid package number", "INVALID_PACKAGE_NUMBER");
  }
  const cursor = decodeCursor(filters.cursor);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const values = [
    wallet, category, filters.eventType?.trim().toUpperCase() || null,
    filters.status?.trim().toUpperCase() || null, optionalDate(filters.fromDate),
    optionalDate(filters.toDate, true), sourceWallet, filters.txHash?.trim().toLowerCase() || null,
    packageNumber, cursor?.occurredAt || null, cursor?.id || null, limit + 1,
  ];
  const result = await query<any>(
    `SELECT id,category,event_type,title,description,amount::text,currency,direction,source_wallet,
       sponsor_wallet,referral_level,package_number,package_amount::text,matrix_type,
       matrix_package_number,cycle_number,recycle_number,position_number,previous_balance::text,
       new_balance::text,fee_amount::text,net_amount::text,status,tx_hash,block_number,log_index,
       source_table,source_record_id,metadata,occurred_at,created_at
     FROM activity_history
     WHERE lower(user_wallet)=lower($1)
       AND ($2::text IS NULL OR category=$2)
       AND ($3::text IS NULL OR event_type=$3)
       AND ($4::text IS NULL OR status=$4)
       AND ($5::timestamptz IS NULL OR occurred_at >= $5)
       AND ($6::timestamptz IS NULL OR occurred_at <= $6)
       AND ($7::text IS NULL OR lower(source_wallet)=lower($7))
       AND ($8::text IS NULL OR lower(tx_hash)=lower($8))
       AND ($9::int IS NULL OR package_number=$9)
       AND ($10::timestamptz IS NULL OR (occurred_at,id)<($10,$11::uuid))
     ORDER BY occurred_at DESC,id DESC LIMIT $12`,
    values,
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit).map((row: any) => ({
    id: row.id, category: row.category, eventType: row.event_type, type: row.event_type,
    title: row.title, description: row.description, amount: row.amount, currency: row.currency,
    direction: row.direction, sourceWallet: row.source_wallet, sponsorWallet: row.sponsor_wallet,
    referralLevel: row.referral_level, packageNumber: row.package_number,
    packageAmount: row.package_amount, matrixType: row.matrix_type,
    matrixPackageNumber: row.matrix_package_number, cycleNumber: row.cycle_number,
    recycleNumber: row.recycle_number, positionNumber: row.position_number,
    previousBalance: row.previous_balance, newBalance: row.new_balance, feeAmount: row.fee_amount,
    netAmount: row.net_amount, status: row.status, txHash: row.tx_hash,
    blockNumber: row.block_number, logIndex: row.log_index, sourceTable: row.source_table,
    sourceRecordId: row.source_record_id, metadata: row.metadata || {},
    occurredAt: new Date(row.occurred_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    // Compatibility aliases for the existing card component.
    packageId: row.package_number, cycle: row.cycle_number, recycleCount: row.recycle_number,
    level: row.referral_level, position: row.position_number, incomeType: row.event_type,
  }));
  return { items, nextCursor: hasMore ? encodeCursor(result.rows[limit - 1]) : null };
}
