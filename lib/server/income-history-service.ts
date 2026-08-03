import { normalizeWallet } from "./auth";
import { query } from "./db";
import { SPLIT_INCOME_TYPES } from "./earning-split-service";
import { ApiError } from "./http";

export type IncomeType = typeof SPLIT_INCOME_TYPES[number];

type Cursor = { createdAt: string; id: string };
type IncomeHistoryRow = {
  id: string;
  income_type: IncomeType;
  source_reference: string;
  credited_amount: string;
  created_at: Date;
};

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed.createdAt || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id) || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid income history cursor", "INVALID_CURSOR");
  }
}

function encodeCursor(row: IncomeHistoryRow) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id })).toString("base64url");
}

export function parseIncomeType(value: string | null): IncomeType {
  if (!value || !SPLIT_INCOME_TYPES.includes(value as IncomeType)) {
    throw new ApiError(400, "Invalid income type", "INVALID_INCOME_TYPE");
  }
  return value as IncomeType;
}

export async function getIncomeHistory(wallet: string, parameters: URLSearchParams) {
  const incomeType = parseIncomeType(parameters.get("incomeType"));
  const cursor = decodeCursor(parameters.get("cursor"));
  const requestedLimit = Number(parameters.get("limit") || 20);
  const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
  const user = (await query<{ id: string }>(
    "SELECT id FROM users WHERE lower(wallet_address)=lower($1)",
    [normalizeWallet(wallet)],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");

  const result = await query<IncomeHistoryRow>(
    `SELECT id,income_type,source_reference,credited_amount::text,created_at
     FROM income_credit_ledger
     WHERE user_id=$1 AND income_type=$2
       AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
     ORDER BY created_at DESC,id DESC LIMIT $5`,
    [user.id, incomeType, cursor?.createdAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}
