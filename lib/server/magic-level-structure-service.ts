import { normalizeWallet } from "./auth";
import { smartEarningDeployment } from "../blockchain/deployment-metadata";
import { query } from "./db";
import { ApiError } from "./http";

export type MagicLevelUser = {
  id: string;
  memberId: string;
  wallet: string;
  level: number;
  position: number;
  registrationId: string | null;
  transactionHash: string | null;
  placedAt: Date;
};

type Cursor = { placedAt: string; id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function activeUserId(wallet: string) {
  const user = (await query<{ id: string }>(
    "SELECT id FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'",
    [normalizeWallet(wallet)],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");
  return user.id;
}

function selectedLevel(value: string | null) {
  if (!value || !/^\d+$/.test(value)) throw new ApiError(400, "Invalid Magic Level", "INVALID_LEVEL");
  const level = Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new ApiError(400, "Invalid Magic Level", "INVALID_LEVEL");
  }
  return level;
}

function cursorFrom(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed.placedAt || !uuid.test(parsed.id) || Number.isNaN(Date.parse(parsed.placedAt))) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(400, "Invalid Magic Level cursor", "INVALID_CURSOR");
  }
}

const descendantsCte = `WITH RECURSIVE descendants AS (
  SELECT p.*,1::int relative_level,ARRAY[$1::uuid,p.user_id]::uuid[] traversal_path,
    (p.position+1)::int visible_position
  FROM matrix_placements p
  WHERE p.parent_user_id=$1 AND p.contract_address=$2
  UNION ALL
  SELECT child.*,parent.relative_level+1,parent.traversal_path||child.user_id,
    (parent.visible_position*2+child.position+1)::int visible_position
  FROM descendants parent
  JOIN matrix_placements child
    ON child.parent_user_id=parent.user_id
   AND child.contract_address=parent.contract_address
  WHERE parent.relative_level<20 AND NOT child.user_id=ANY(parent.traversal_path)
)`;

const reportDescendantsCte = `WITH RECURSIVE descendants(user_id,relative_level,traversal_path) AS (
  SELECT p.user_id,1::int,ARRAY[$1::uuid,p.user_id]::uuid[]
  FROM matrix_placements p WHERE p.parent_user_id=$1
  UNION ALL
  SELECT child.user_id,parent.relative_level+1,parent.traversal_path||child.user_id
  FROM descendants parent JOIN matrix_placements child ON child.parent_user_id=parent.user_id
  WHERE parent.relative_level<20 AND NOT child.user_id=ANY(parent.traversal_path)
)`;

export function requiredMagicDirects(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 20) throw new Error("Invalid Magic Level");
  return Math.ceil(level / 2);
}

export function magicLevelStatus(level: number, userCount: number, qualifiedDirects: number) {
  return userCount > 0 && qualifiedDirects >= requiredMagicDirects(level) ? "ACHIEVED" as const : "PENDING" as const;
}

export async function getMagicLevelReport(wallet: string) {
  const userId = await activeUserId(wallet);
  const [counts, directs, income] = await Promise.all([
    query<{ level: number; userCount: number }>(`${reportDescendantsCte},counts AS (
      SELECT relative_level,count(DISTINCT user_id)::int user_count FROM descendants GROUP BY relative_level
    ) SELECT levels.level,COALESCE(counts.user_count,0)::int "userCount"
      FROM generate_series(1,20) levels(level) LEFT JOIN counts ON counts.relative_level=levels.level
      ORDER BY levels.level`, [userId]),
    query<{ count: number }>(`SELECT count(*)::int count FROM referral_relations rr
      JOIN users u ON u.id=rr.user_id AND u.status='ACTIVE' WHERE rr.sponsor_user_id=$1`, [userId]),
    query<{ total: string }>(`SELECT COALESCE(sum(income_amount),0)::text total FROM earning_split_events
      WHERE user_id=$1 AND income_type='MAGIC_LEVEL_INCOME'`, [userId]),
  ]);
  const qualifiedDirects = directs.rows[0]?.count || 0;
  return {
    magicIncome: income.rows[0]?.total || "0",
    qualifiedDirects,
    levels: counts.rows.map(row => ({
      level: row.level, requiredDirects: requiredMagicDirects(row.level),
      qualifiedDirects, currentTeam: row.userCount,
      status: magicLevelStatus(row.level, row.userCount, qualifiedDirects),
    })),
  };
}

export async function getMagicLevelStructure(wallet: string) {
  const userId = await activeUserId(wallet);
  const contractAddress = smartEarningDeployment().address;
  const result = await query<{ level: number; userCount: number }>(
    `${descendantsCte}, counts AS (
       SELECT relative_level,count(DISTINCT user_id)::int user_count
       FROM descendants GROUP BY relative_level
     )
     SELECT levels.level,COALESCE(counts.user_count,0)::int "userCount"
     FROM generate_series(1,20) levels(level)
     LEFT JOIN counts ON counts.relative_level=levels.level
     ORDER BY levels.level`,
    [userId, contractAddress],
  );
  return { levels: result.rows };
}

export async function getMagicLevelUsers(wallet: string, parameters: URLSearchParams) {
  const level = selectedLevel(parameters.get("level"));
  const cursor = cursorFrom(parameters.get("cursor"));
  const requested = Number(parameters.get("limit") || 20);
  const limit = Number.isInteger(requested) ? Math.min(50, Math.max(1, requested)) : 20;
  const userId = await activeUserId(wallet);
  const contractAddress = smartEarningDeployment().address;
  const result = await query<MagicLevelUser>(
    `${descendantsCte}
     SELECT p.id,p.user_id "memberId",u.wallet_address wallet,p.relative_level level,
       p.visible_position position,p.registration_id "registrationId",p.transaction_hash "transactionHash",p.created_at "placedAt"
     FROM descendants p JOIN users u ON u.id=p.user_id
     WHERE p.relative_level=$3
       AND ($4::timestamptz IS NULL OR (p.created_at,p.id)<($4::timestamptz,$5::uuid))
     ORDER BY p.created_at DESC,p.id DESC LIMIT $6`,
    [userId, contractAddress, level, cursor?.placedAt || null, cursor?.id || null, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ placedAt: last.placedAt.toISOString(), id: last.id })).toString("base64url")
    : null;
  return { items, nextCursor };
}
