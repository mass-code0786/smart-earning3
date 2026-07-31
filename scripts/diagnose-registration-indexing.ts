import { Contract } from "ethers";
import deployment from "../deployments/bsc-testnet.json";
import { normalizeWallet } from "../lib/server/auth";
import { getProvider } from "../lib/blockchain/provider";
import { SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import {
  findRegistrationTransactionForWallet,
  inspectRegistrationProjection,
} from "../lib/server/registration-tx-reconciliation";
import { getServerConfig } from "../lib/server/config";

loadAuthoritativeEnvironment(process.cwd());

type DiscoveredRegistration = Awaited<ReturnType<typeof findRegistrationTransactionForWallet>>;
type DiscoveryFailure = { errorCode: string | null; error: string };

async function main() {
  const walletArgument = process.argv.slice(2).find((value) => value.startsWith("--wallet="));
  if (!walletArgument) {
    throw new Error("Usage: npm run diagnose:registration-indexing -- --wallet=0x...");
  }
  const wallet = normalizeWallet(walletArgument.slice("--wallet=".length));
  const config = getServerConfig();
  const provider = getProvider();
  const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, provider);
  const [registered, getterMatrixParent] = await Promise.all([
    contract.registered(wallet),
    contract.matrixParentOf(wallet),
  ]);

  let eventDiscovery: DiscoveredRegistration | DiscoveryFailure;
  try {
    eventDiscovery = await findRegistrationTransactionForWallet(wallet, {
      deploymentBlock: deployment.blockNumber,
    });
  } catch (error) {
    eventDiscovery = {
      errorCode: (error as { code?: string }).code || null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const discovered = "txHash" in eventDiscovery ? eventDiscovery : null;
  const discoveryError = "error" in eventDiscovery ? eventDiscovery.error : null;

  const database = await getPool().query(
    `SELECT
       (SELECT jsonb_build_object(
          'id',u.id,'status',u.status,'wallet',u.wallet_address,'activatedAt',u.activated_at
        ) FROM users u WHERE lower(u.wallet_address)=lower($1)) "user",
       COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at)
        FROM registrations r JOIN users u ON u.id=r.user_id
        WHERE lower(u.wallet_address)=lower($1)),'[]'::jsonb) registrations,
       COALESCE((SELECT jsonb_agg(to_jsonb(mp) ORDER BY mp.created_at)
        FROM matrix_placements mp JOIN users u ON u.id=mp.user_id
        WHERE lower(u.wallet_address)=lower($1)),'[]'::jsonb) "matrixPlacements",
       COALESCE((SELECT jsonb_agg(to_jsonb(bt) ORDER BY bt.block_number,bt.log_index)
        FROM blockchain_transactions bt
        WHERE lower(bt.from_address)=lower($1)
           OR ($2::text IS NOT NULL AND lower(bt.tx_hash)=lower($2))
           OR lower(bt.tx_hash) IN(
             SELECT lower(r.tx_hash) FROM registrations r
             JOIN users u ON u.id=r.user_id WHERE lower(u.wallet_address)=lower($1)
           )),'[]'::jsonb) "blockchainTransactions",
       COALESCE((SELECT jsonb_agg(to_jsonb(pe) ORDER BY pe.block_number,pe.log_index)
        FROM blockchain_processed_events pe
        WHERE ($2::text IS NOT NULL AND lower(pe.transaction_hash)=lower($2))
           OR lower(pe.transaction_hash) IN(
          SELECT lower(r.tx_hash) FROM registrations r
          JOIN users u ON u.id=r.user_id WHERE lower(u.wallet_address)=lower($1)
        )),'[]'::jsonb) "processedEvents",
       COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.chain_id,s.contract_address)
        FROM blockchain_indexer_state s),'[]'::jsonb) checkpoints`,
    [wallet, discovered?.txHash ?? null],
  );
  const rows = database.rows[0] as {
    checkpoints?: Array<{
      chain_id: number; contract_address: string; last_processed_block: string | number;
    }>;
  };
  const currentCheckpoint = rows.checkpoints?.find((checkpoint) =>
    Number(checkpoint.chain_id) === deployment.chainId
    && checkpoint.contract_address.toLowerCase() === deployment.address.toLowerCase());
  const checkpointBlock = currentCheckpoint
    ? Number(currentCheckpoint.last_processed_block) : null;
  const registrationBlockPosition = !discovered ? "UNKNOWN"
    : checkpointBlock === null ? "CHECKPOINT_MISSING"
      : discovered.blockNumber > checkpointBlock ? "ABOVE_CHECKPOINT" : "AT_OR_BELOW_CHECKPOINT";
  const projection = discovered
    ? await inspectRegistrationProjection(
      wallet, discovered.sponsor, discovered.txHash, discovered.matrixParent,
      BigInt(discovered.matrixIndex), discovered.matrixPosition,
    ) : null;
  const missingProjectionRows = projection?.missing || [];
  const finalDiagnosis = !registered
    ? { code: "NOT_REGISTERED_ONCHAIN", message: "Wallet is not registered on-chain." }
    : !discovered
      ? { code: "REGISTRATION_EVENT_UNDISCOVERED", message: discoveryError }
      : missingProjectionRows.length
        ? {
          code: "INCOMPLETE_REGISTRATION_PROJECTION",
          message: `Missing projection rows: ${missingProjectionRows.join(", ")}.`,
        }
        : {
          code: "REGISTRATION_PROJECTION_COMPLETE",
          message: "On-chain registration and required projection rows are present.",
        };

  process.stdout.write(`${JSON.stringify({
    mode: "READ_ONLY",
    wallet,
    onchain: {
      registered: Boolean(registered),
      sponsor: discovered?.sponsor ?? null,
      matrixParent: discovered?.matrixParent
        ?? String(getterMatrixParent).toLowerCase(),
      matrixIndex: discovered?.matrixIndex
        ?? (wallet === deployment.genesis.toLowerCase() ? "0" : null),
      matrixPosition: discovered?.matrixPosition ?? null,
    },
    registrationTransaction: discovered ? {
      txHash: discovered.txHash,
      blockNumber: discovered.blockNumber,
    } : null,
    eventDiscovery,
    database: rows,
    checkpoint: {
      current: checkpointBlock,
      registrationBlockPosition,
    },
    projection,
    missingProjectionRows,
    finalDiagnosis,
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
