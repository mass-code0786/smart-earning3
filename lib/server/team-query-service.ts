import { normalizeWallet } from "./auth";
import { query } from "./db";
import { ApiError } from "./http";

export async function getTeam(walletInput: string) {
  const wallet = normalizeWallet(walletInput);
  const user = (await query<{ id: string; wallet_address: string }>(
    "SELECT id,wallet_address FROM users WHERE lower(wallet_address)=lower($1)",
    [wallet],
  )).rows[0];
  if (!user) throw new ApiError(404, "User is not indexed", "USER_NOT_FOUND");

  const [summary, directs] = await Promise.all([
    query<{
      total_team: number;
      active_members: number;
      inactive_members: number;
    }>(
      `WITH RECURSIVE team AS (
         SELECT rr.user_id
         FROM referral_relations rr
         WHERE rr.sponsor_user_id=$1
         UNION
         SELECT rr.user_id
         FROM referral_relations rr
         JOIN team t ON t.user_id=rr.sponsor_user_id
       )
       SELECT count(*)::int total_team,
              count(*) FILTER (WHERE u.status='ACTIVE')::int active_members,
              count(*) FILTER (WHERE u.status<>'ACTIVE')::int inactive_members
       FROM team JOIN users u ON u.id=team.user_id`,
      [user.id],
    ),
    query<{
      wallet_address: string;
      status: string;
      joined_at: Date;
      active_package_value: string;
    }>(
      `SELECT child.wallet_address,child.status,
              COALESCE(r.confirmed_at,child.created_at) joined_at,
              COALESCE(ups.total_package_value,0)::text active_package_value
       FROM referral_relations rr
       JOIN users child ON child.id=rr.user_id
       LEFT JOIN registrations r ON r.id=rr.registration_id
       LEFT JOIN user_package_states ups ON ups.user_id=child.id
       WHERE rr.sponsor_user_id=$1
       ORDER BY COALESCE(r.confirmed_at,child.created_at) DESC`,
      [user.id],
    ),
  ]);

  return {
    referralIdentifier: user.wallet_address,
    directMembers: directs.rows.length,
    totalTeam: summary.rows[0]?.total_team || 0,
    activeMembers: summary.rows[0]?.active_members || 0,
    inactiveMembers: summary.rows[0]?.inactive_members || 0,
    directs: directs.rows,
  };
}
