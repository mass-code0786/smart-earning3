import { normalizeWallet } from "../lib/server/auth";
import { transaction, getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";

loadAuthoritativeEnvironment(process.cwd());
async function main() {
  if (!process.env.GENESIS_WALLET) throw new Error("GENESIS_WALLET is required");
  const wallet = normalizeWallet(process.env.GENESIS_WALLET);
  await transaction(async (client) => {
    const user = await client.query<{ id: string }>(
      `INSERT INTO users(wallet_address,status,role,activated_at)
       VALUES($1,'ACTIVE','ADMIN',now())
       ON CONFLICT(wallet_address) DO UPDATE SET role='ADMIN',status='ACTIVE'
       RETURNING id`,
      [wallet],
    );
    await client.query(
      `INSERT INTO matrix_placements(user_id,parent_user_id,position,bfs_index)
       VALUES($1,NULL,NULL,0) ON CONFLICT(user_id) DO NOTHING`,
      [user.rows[0].id],
    );
    const registrationValue = 2_000_000n;
    await client.query(
      `INSERT INTO user_package_states(
        user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap
       ) VALUES($1,$2,$2,$3,0,$3) ON CONFLICT(user_id) DO NOTHING`,
      [user.rows[0].id, registrationValue.toString(), (registrationValue*5n).toString()],
    );
    await client.query(
      `INSERT INTO earning_cap_ledger(
        user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
       ) VALUES($1,'REGISTRATION',$2,$3,$4,$4)
       ON CONFLICT(source_type,source_reference) DO NOTHING`,
      [user.rows[0].id,`genesis:${wallet}`,registrationValue.toString(),(registrationValue*5n).toString()],
    );
  });
  await getPool().end();
  process.stdout.write(`Genesis/admin indexed: ${wallet}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
