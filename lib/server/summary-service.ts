import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";

export async function getUserSummary(wallet: string, page = 1, pageSize = 20) {
  const user = (await query<{ id: string }>(
    "SELECT id FROM users WHERE wallet_address=$1 AND status='ACTIVE'", [normalizeWallet(wallet)],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");
  const size = Math.min(50, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const result = await query<{
    id: string; direction: "CREDIT" | "DEBIT"; amount: string; reason: string;
    income_type: string | null; source_reference: string | null; status: string | null;
    created_at: Date;
  }>(`SELECT l.id,l.direction,l.amount::text,l.reason,e.income_type,e.source_reference,
      w.status,l.created_at
    FROM income_wallet_ledger l
    LEFT JOIN earning_split_events e ON e.id=l.split_event_id
    LEFT JOIN auto_withdrawals w ON w.id=l.withdrawal_id
    WHERE l.user_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT $2 OFFSET $3`,
    [user.id, size + 1, (safePage - 1) * size]);
  const hasMore = result.rows.length > size;
  return { page: safePage, pageSize: size, hasMore, items: result.rows.slice(0, size) };
}
