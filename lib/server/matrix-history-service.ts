import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";

export const MATRIX_HISTORY_MODULES = ["MAGIC_LEVEL", "X3", "X4", "BOOSTER", "AUTOPOOL"] as const;
export type MatrixHistoryModule = typeof MATRIX_HISTORY_MODULES[number];

export type MatrixHistoryItem = {
  id: string;
  memberId: string;
  wallet: string;
  module: MatrixHistoryModule;
  level: number | null;
  position: number;
  levelPosition: number | null;
  childSlot: number | null;
  packageId: number | null;
  amount: string | null;
  transactionHash: string | null;
  reference: string | null;
  placedAt: Date;
};

type Cursor = { placedAt: string; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function moduleFrom(value: string | null): MatrixHistoryModule {
  if (!value || !MATRIX_HISTORY_MODULES.includes(value as MatrixHistoryModule)) {
    throw new ApiError(400, "Invalid matrix module", "INVALID_MATRIX_MODULE");
  }
  return value as MatrixHistoryModule;
}

function cursorFrom(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed.placedAt || !uuid.test(parsed.id) || Number.isNaN(Date.parse(parsed.placedAt))) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid matrix history cursor", "INVALID_CURSOR");
  }
}

function positiveInteger(value: string | null, name: string, maximum?: number) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new ApiError(400, `Invalid ${name}`, `INVALID_${name.toUpperCase()}`);
  }
  return parsed;
}

function entryId(value: string | null) {
  if (!value || !uuid.test(value)) throw new ApiError(400, "Invalid matrix entry", "INVALID_ENTRY");
  return value;
}

function encodeCursor(row: MatrixHistoryItem) {
  return Buffer.from(JSON.stringify({ placedAt: row.placedAt.toISOString(), id: row.id })).toString("base64url");
}

async function activeUserId(wallet: string) {
  const user = (await query<{ id: string }>(
    "SELECT id FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'",
    [normalizeWallet(wallet)],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");
  return user.id;
}

export async function getMatrixHistory(wallet: string, parameters: URLSearchParams) {
  const module = moduleFrom(parameters.get("module"));
  const cursor = cursorFrom(parameters.get("cursor"));
  const requested = Number(parameters.get("limit") || 20);
  const limit = Number.isInteger(requested) ? Math.min(50, Math.max(1, requested)) : 20;
  const userId = await activeUserId(wallet);
  const packageId = module === "X3" || module === "X4" ? positiveInteger(parameters.get("packageId"), "package", 8) : null;
  if ((module === "X3" || module === "X4") && packageId === null) throw new ApiError(400, "Matrix package is required", "PACKAGE_REQUIRED");
  const selectedEntryId = module === "BOOSTER" || module === "AUTOPOOL" ? entryId(parameters.get("entryId")) : null;
  const pageValues = [cursor?.placedAt || null, cursor?.id || null, limit + 1];
  let result: { rows: MatrixHistoryItem[] };

  if (module === "MAGIC_LEVEL") {
    result = await query<MatrixHistoryItem>(
      `WITH RECURSIVE placements AS (
         SELECT p.*,1::int matrix_level,(p.position+1)::int visible_position
         FROM matrix_placements p WHERE p.parent_user_id=$1
         UNION ALL
         SELECT child.*,parent.matrix_level+1,
           (parent.visible_position*2+child.position+1)::int visible_position
         FROM placements parent
         JOIN matrix_placements child ON child.parent_user_id=parent.user_id
       )
       SELECT p.id,p.user_id "memberId",u.wallet_address wallet,'MAGIC_LEVEL' module,
         p.matrix_level level,p.visible_position position,NULL::int "levelPosition",NULL::int "childSlot",
         NULL::int "packageId",r.amount_token_units::text amount,
         COALESCE(p.transaction_hash,r.tx_hash) "transactionHash",p.registration_id::text reference,p.created_at "placedAt"
       FROM placements p JOIN users u ON u.id=p.user_id LEFT JOIN registrations r ON r.id=p.registration_id
       WHERE ($2::timestamptz IS NULL OR (p.created_at,p.id)<($2::timestamptz,$3::uuid))
       ORDER BY p.created_at DESC,p.id DESC LIMIT $4`,
      [userId, ...pageValues],
    );
  } else if (module === "X3") {
    result = await query<MatrixHistoryItem>(
      `SELECT s.id,s.placed_user_id "memberId",u.wallet_address wallet,'X3' module,
         1::int level,s.slot_number position,NULL::int "levelPosition",NULL::int "childSlot",
         c.package_id "packageId",pp.amount_token_units::text amount,s.source_transaction_hash "transactionHash",
         s.placed_user_cycle_id::text reference,s.placed_at "placedAt"
       FROM x3_cycle_slots s JOIN x3_cycles c ON c.id=s.cycle_id JOIN users u ON u.id=s.placed_user_id
       LEFT JOIN package_purchases pp ON pp.id=s.placed_user_purchase_id
       WHERE c.user_id=$1 AND c.package_id=$2
         AND ($3::timestamptz IS NULL OR (s.placed_at,s.id)<($3::timestamptz,$4::uuid))
       ORDER BY s.placed_at DESC,s.id DESC LIMIT $5`,
      [userId, packageId, ...pageValues],
    );
  } else if (module === "X4") {
    result = await query<MatrixHistoryItem>(
      `SELECT p.id,p.placed_user_id "memberId",u.wallet_address wallet,'X4' module,
         p.level_number level,p.slot_number position,NULL::int "levelPosition",NULL::int "childSlot",
         c.package_id "packageId",pp.amount_token_units::text amount,p.source_transaction_hash "transactionHash",
         p.placed_cycle_id::text reference,p.created_at "placedAt"
       FROM x4_positions p JOIN x4_cycles c ON c.id=p.owner_cycle_id JOIN users u ON u.id=p.placed_user_id
       LEFT JOIN package_purchases pp ON pp.id=p.source_package_purchase_id
       WHERE c.user_id=$1 AND c.package_id=$2
         AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid))
       ORDER BY p.created_at DESC,p.id DESC LIMIT $5`,
      [userId, packageId, ...pageValues],
    );
  } else if (module === "BOOSTER") {
    result = await query<MatrixHistoryItem>(
      `SELECT p.id,p.placed_user_id "memberId",u.wallet_address wallet,'BOOSTER' module,
         NULL::int level,p.slot_number position,NULL::int "levelPosition",NULL::int "childSlot",
         NULL::int "packageId",NULL::text amount,NULL::text "transactionHash",
         p.placed_entry_id::text reference,p.created_at "placedAt"
       FROM booster_positions p JOIN booster_entries e ON e.id=p.owner_entry_id JOIN users u ON u.id=p.placed_user_id
       WHERE e.owner_user_id=$1 AND e.id=$2
         AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid))
       ORDER BY p.created_at DESC,p.id DESC LIMIT $5`,
      [userId, selectedEntryId, ...pageValues],
    );
  } else {
    result = await query<MatrixHistoryItem>(
      `SELECT p.id,p.placed_user_id "memberId",u.wallet_address wallet,'AUTOPOOL' module,
         p.matrix_level level,p.position_number position,p.level_position "levelPosition",p.child_slot "childSlot",
         NULL::int "packageId",NULL::text amount,NULL::text "transactionHash",
         p.placed_entry_id::text reference,p.created_at "placedAt"
       FROM autopool_positions p JOIN autopool_entries e ON e.id=p.owner_entry_id JOIN users u ON u.id=p.placed_user_id
       WHERE e.owner_user_id=$1 AND e.id=$2
         AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid))
       ORDER BY p.created_at DESC,p.id DESC LIMIT $5`,
      [userId, selectedEntryId, ...pageValues],
    );
  }

  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}
