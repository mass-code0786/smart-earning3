import { getAddress } from "ethers";
import type { PoolClient } from "pg";

export type GenesisBootstrapResult = {
  wallet: string;
  userId: string;
  status: "ACTIVE";
  rootPlacement: true;
  createdUser: boolean;
};

export async function bootstrapGenesis(
  client: PoolClient,
  walletInput: string,
  registrationValueInput: bigint,
): Promise<GenesisBootstrapResult> {
  const wallet = getAddress(walletInput.trim()).toLowerCase();
  if (registrationValueInput <= 0n) throw new Error("Genesis registration value must be positive");
  const registrationValue = registrationValueInput.toString();

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["genesis-bootstrap"]);
  const existingRoot = await client.query<{ wallet_address: string }>(
    `SELECT u.wallet_address FROM matrix_placements p
     JOIN users u ON u.id=p.user_id
     WHERE p.bfs_index=0 AND p.contract_address IS NULL`,
  );
  if (existingRoot.rows[0] && existingRoot.rows[0].wallet_address !== wallet) {
    throw new Error(`Genesis bootstrap refused: database root is ${existingRoot.rows[0].wallet_address}`);
  }

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE wallet_address=$1",
    [wallet],
  );
  const user = await client.query<{ id: string }>(
    `INSERT INTO users(wallet_address,status,role,activated_at)
     VALUES($1,'ACTIVE','ADMIN',now())
     ON CONFLICT(wallet_address) DO UPDATE
       SET status='ACTIVE',activated_at=COALESCE(users.activated_at,now())
     RETURNING id`,
    [wallet],
  );
  const userId = user.rows[0].id;

  await client.query(
    `INSERT INTO matrix_placements(user_id,parent_user_id,position,bfs_index)
     VALUES($1,NULL,NULL,0) ON CONFLICT(user_id) DO NOTHING`,
    [userId],
  );
  const root = await client.query<{ valid: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM matrix_placements
       WHERE user_id=$1 AND parent_user_id IS NULL AND position IS NULL
         AND bfs_index=0 AND contract_address IS NULL) valid`,
    [userId],
  );
  if (!root.rows[0]?.valid) throw new Error("Genesis bootstrap refused: wallet has a conflicting matrix placement");

  await client.query(
    `INSERT INTO user_package_states(
       user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap
     ) VALUES($1,$2,0,0,0,0) ON CONFLICT(user_id) DO NOTHING`,
    [userId, registrationValue],
  );
  const packageState = await client.query<{
    registration_value: string; total_eligible_value: string; total_earning_cap: string;
  }>(
    `SELECT registration_value::text,total_eligible_value::text,total_earning_cap::text
     FROM user_package_states WHERE user_id=$1`,
    [userId],
  );
  const state = packageState.rows[0];
  if (
    state?.registration_value !== registrationValue
    || BigInt(state.total_eligible_value) !== 0n
    || BigInt(state.total_earning_cap) !== 0n
  ) {
    throw new Error("Genesis bootstrap refused: registration baseline conflicts with existing state");
  }

  return { wallet, userId, status: "ACTIVE", rootPlacement: true, createdUser: existing.rowCount === 0 };
}
