import { Contract } from "ethers";
import deployment from "../deployments/bsc-testnet.json";
import { normalizeWallet } from "../lib/server/auth";
import { getProvider } from "../lib/blockchain/provider";
import { SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { findRegistrationTransactionForWallet } from "../lib/server/registration-tx-reconciliation";
import { getServerConfig } from "../lib/server/config";

loadAuthoritativeEnvironment(process.cwd());

async function main() {
  const walletArgument = process.argv.slice(2).find((value) => value.startsWith("--wallet="));
  if (!walletArgument) {
    throw new Error("Usage: npm run diagnose:registration-indexing -- --wallet=0x...");
  }
  const wallet = normalizeWallet(walletArgument.slice("--wallet=".length));
  const config = getServerConfig();
  const provider = getProvider();
  const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, provider);
  const database = await getPool().query(
    `SELECT
       (SELECT jsonb_build_object(
          'id',u.id,'status',u.status,'wallet',u.wallet_address,'activatedAt',u.activated_at
        ) FROM users u WHERE u.wallet_address=$1) "user",
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',r.id,'txHash',r.tx_hash,'status',r.status,'blockNumber',r.block_number,
          'sponsorUserId',r.sponsor_user_id
        ) ORDER BY r.created_at) FROM registrations r
        JOIN users u ON u.id=r.user_id WHERE u.wallet_address=$1),'[]'::jsonb) registrations,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',mp.id,'parentUserId',mp.parent_user_id,'position',mp.position,
          'bfsIndex',mp.bfs_index,'registrationId',mp.registration_id
        )) FROM matrix_placements mp
        JOIN users u ON u.id=mp.user_id WHERE u.wallet_address=$1),'[]'::jsonb) placements,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'chainId',s.chain_id,'contractAddress',s.contract_address,
          'lastProcessedBlock',s.last_processed_block,'updatedAt',s.updated_at
        )) FROM blockchain_indexer_state s),'[]'::jsonb) checkpoints,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'transactionHash',e.transaction_hash,'logIndex',e.log_index,
          'blockNumber',e.block_number,'eventName',e.event_name
        ) ORDER BY e.block_number,e.log_index)
        FROM blockchain_processed_events e
        JOIN blockchain_transactions bt
          ON bt.chain_id=e.chain_id AND bt.tx_hash=e.transaction_hash
        WHERE lower(bt.from_address)=lower($1)),'[]'::jsonb) "processedEvents"`,
    [wallet],
  );
  const [registered, matrixParent, matrixIndex] = await Promise.all([
    contract.registered(wallet),
    contract.matrixParentOf(wallet),
    contract.matrixIndexOf(wallet),
  ]);
  let eventDiscovery: unknown;
  try {
    eventDiscovery = await findRegistrationTransactionForWallet(wallet, {
      deploymentBlock: Number(
        process.env.SMART_EARNING_DEPLOYMENT_BLOCK || deployment.blockNumber,
      ),
    });
  } catch (error) {
    eventDiscovery = {
      errorCode: (error as { code?: string }).code || null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  process.stdout.write(`${JSON.stringify({
    mode: "READ_ONLY",
    wallet,
    database: database.rows[0],
    onchain: {
      registered,
      matrixParent: String(matrixParent).toLowerCase(),
      matrixIndex: matrixIndex.toString(),
    },
    eventDiscovery,
  }, null, 2)}\n`);
}

main().catch(async (error) => {
  console.error(
    `[registration-indexing-diagnostic] ${error instanceof Error ? error.message : String(error)}`,
  );
  await getPool().end().catch(() => undefined);
  process.exitCode = 2;
}).finally(async () => {
  await getPool().end().catch(() => undefined);
});
