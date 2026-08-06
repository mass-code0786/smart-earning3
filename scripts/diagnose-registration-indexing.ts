import { Contract } from "ethers";
import type { PoolClient } from "pg";
import deployment from "../deployments/bsc-testnet.json";
import { normalizeWallet } from "../lib/server/auth";
import { getProvider } from "../lib/blockchain/provider";
import { SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import {
  findRegistrationTransactionForWallet,
} from "../lib/server/registration-tx-reconciliation";
import { getServerConfig } from "../lib/server/config";

loadAuthoritativeEnvironment(process.cwd());

type DiscoveredRegistration = Awaited<ReturnType<typeof findRegistrationTransactionForWallet>>;
type DiscoveryFailure = { errorCode: string | null; error: string };
const RPC_TIMEOUT_MS = 15_000;
const EVENT_DISCOVERY_TIMEOUT_MS = 60_000;
const DATABASE_TIMEOUT_MS = 15_000;
let diagnosticProvider: ReturnType<typeof getProvider> | undefined;
let diagnosticPool: ReturnType<typeof getPool> | undefined;
let diagnosticClient: PoolClient | undefined;

export function withDiagnosticTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function progress(message: string) {
  process.stderr.write(`[registration-indexing-diagnostic] ${message}\n`);
}

async function main() {
  const walletArgument = process.argv.slice(2).find((value) => value.startsWith("--wallet="));
  if (!walletArgument) {
    throw new Error("Usage: npm run diagnose:registration-indexing -- --wallet=0x...");
  }
  const wallet = normalizeWallet(walletArgument.slice("--wallet=".length));
  const config = getServerConfig();
  const provider = diagnosticProvider = getProvider();
  const contract = new Contract(config.SMART_EARNING_CONTRACT_ADDRESS, SMART_EARNING_ABI, provider);
  progress(`wallet ${wallet}`);
  progress("RPC: reading registered(address)");
  const registered = await withDiagnosticTimeout(
    "registered(address)", contract.registered(wallet), RPC_TIMEOUT_MS,
  );
  progress("RPC: reading matrixParentOf(address)");
  const getterMatrixParent = await withDiagnosticTimeout(
    "matrixParentOf(address)", contract.matrixParentOf(wallet), RPC_TIMEOUT_MS,
  );

  let eventDiscovery: DiscoveredRegistration | DiscoveryFailure;
  let eventDiscoveryActive = true;
  const assertEventDiscoveryActive = () => {
    if (!eventDiscoveryActive) throw new Error("UserRegistered event discovery cancelled");
  };
  try {
    const timedEventProvider = {
      getNetwork: () => {
        assertEventDiscoveryActive();
        progress("RPC: reading network for event discovery");
        return withDiagnosticTimeout("event getNetwork", provider.getNetwork(), RPC_TIMEOUT_MS);
      },
      getBlockNumber: () => {
        assertEventDiscoveryActive();
        progress("RPC: reading latest block for event discovery");
        return withDiagnosticTimeout("event getBlockNumber", provider.getBlockNumber(), RPC_TIMEOUT_MS);
      },
      getLogs: (filter: Parameters<typeof provider.getLogs>[0]) => {
        assertEventDiscoveryActive();
        const range = filter as { fromBlock?: unknown; toBlock?: unknown };
        progress(`RPC: querying UserRegistered logs ${range.fromBlock}-${range.toBlock}`);
        return withDiagnosticTimeout("event getLogs", provider.getLogs(filter), RPC_TIMEOUT_MS);
      },
      getTransactionReceipt: (txHash: string) => {
        assertEventDiscoveryActive();
        progress(`RPC: reading registration receipt ${txHash}`);
        return withDiagnosticTimeout(
          "event getTransactionReceipt", provider.getTransactionReceipt(txHash), RPC_TIMEOUT_MS,
        );
      },
    };
    progress(`RPC: discovering UserRegistered event from block ${deployment.blockNumber}`);
    eventDiscovery = await withDiagnosticTimeout(
      "UserRegistered event discovery",
      findRegistrationTransactionForWallet(wallet, {
        deploymentBlock: deployment.blockNumber,
        provider: timedEventProvider,
      }),
      EVENT_DISCOVERY_TIMEOUT_MS,
    );
  } catch (error) {
    eventDiscovery = {
      errorCode: (error as { code?: string }).code || null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    eventDiscoveryActive = false;
  }
  const discovered = "txHash" in eventDiscovery ? eventDiscovery : null;
  const discoveryError = "error" in eventDiscovery ? eventDiscovery.error : null;

  progress("database: reading diagnostic projection rows and checkpoints");
  const pool = diagnosticPool = getPool();
  progress("database: acquiring read-only client");
  const client = diagnosticClient = await withDiagnosticTimeout(
    "database connection", pool.connect(), DATABASE_TIMEOUT_MS,
  );
  progress("database: starting read-only transaction");
  await withDiagnosticTimeout(
    "database BEGIN READ ONLY", client.query("BEGIN READ ONLY"), DATABASE_TIMEOUT_MS,
  );
  progress(`database: applying ${DATABASE_TIMEOUT_MS}ms statement timeout`);
  await withDiagnosticTimeout(
    "database statement timeout",
    client.query(`SET LOCAL statement_timeout = '${DATABASE_TIMEOUT_MS}ms'`),
    DATABASE_TIMEOUT_MS,
  );
  const database = await withDiagnosticTimeout("database diagnostic query", client.query(
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
  ), DATABASE_TIMEOUT_MS);
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
  let projection = null;
  if (discovered) {
    progress("database: inspecting required registration projections");
    const projectionResult = await withDiagnosticTimeout(
      "database projection query", client.query(`SELECT
        EXISTS(SELECT 1 FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE') user_exists,
        EXISTS(SELECT 1 FROM registrations WHERE lower(tx_hash)=lower($3) AND status='CONFIRMED') registration_exists,
        EXISTS(SELECT 1 FROM referral_relations rr JOIN users child ON child.id=rr.user_id
          JOIN users parent ON parent.id=rr.sponsor_user_id
          WHERE lower(child.wallet_address)=lower($1) AND lower(parent.wallet_address)=lower($2)) relation_exists,
        (SELECT count(*)::int FROM referral_relations rr JOIN users child ON child.id=rr.user_id
          JOIN users parent ON parent.id=rr.sponsor_user_id
          WHERE lower(child.wallet_address)=lower($1) AND lower(parent.wallet_address)=lower($2)) relation_count,
        EXISTS(SELECT 1 FROM activity_history WHERE event_type='DIRECT_REFERRAL_ACTIVATED'
          AND lower(user_wallet)=lower($2) AND lower(source_wallet)=lower($1)
          AND lower(tx_hash)=lower($3)) history_exists,
        (SELECT count(*)::int FROM activity_history WHERE event_type='DIRECT_REFERRAL_ACTIVATED'
          AND lower(user_wallet)=lower($2) AND lower(source_wallet)=lower($1)
          AND lower(tx_hash)=lower($3)) history_count,
        (SELECT direct_count::int FROM users WHERE lower(wallet_address)=lower($2) LIMIT 1)
          sponsor_direct_count,
        (SELECT count(*)::int FROM matrix_placements mp JOIN users u ON u.id=mp.user_id
          WHERE lower(u.wallet_address)=lower($1)) placement_count,
        EXISTS(SELECT 1 FROM users WHERE lower(wallet_address)=lower($4)) matrix_parent_indexed,
        EXISTS(SELECT 1 FROM matrix_placements mp JOIN users child ON child.id=mp.user_id
          JOIN users parent ON parent.id=mp.parent_user_id WHERE lower(child.wallet_address)=lower($1)
          AND lower(parent.wallet_address)=lower($4)
          AND lower(mp.contract_address)=lower($8)
          AND mp.contract_matrix_index=$5 AND mp.position=$6)
          expected_placement_exists,
        (SELECT count(*)::int FROM direct_income_ledger d JOIN users u ON u.id=d.source_user_id
          WHERE lower(u.wallet_address)=lower($1) AND lower(d.tx_hash)=lower($3)) direct_income_count,
        (SELECT count(*)::int FROM magic_wallet_ledger m JOIN users u ON u.id=m.user_id
          WHERE lower(u.wallet_address)=lower($1)
            AND m.idempotency_key=$7) magic_credit_count`, [wallet, discovered.sponsor, discovered.txHash,
        discovered.matrixParent, discovered.matrixIndex, discovered.matrixPosition,
        `registration:${discovered.txHash.toLowerCase()}:magic`, discovered.contractAddress]),
      DATABASE_TIMEOUT_MS,
    );
    const state = projectionResult.rows[0];
    projection = {
      ...state,
      missing: [
        !state?.user_exists && "user",
        !state?.registration_exists && "registration",
        !state?.relation_exists && "referral_relation",
        !state?.history_exists && "direct_referral_history",
        !state?.matrix_parent_indexed && "matrix_parent",
        !state?.expected_placement_exists && "matrix_placement",
      ].filter(Boolean),
    };
  }
  progress("database: committing read-only transaction");
  await withDiagnosticTimeout("database COMMIT", client.query("COMMIT"), DATABASE_TIMEOUT_MS);
  client.release();
  diagnosticClient = undefined;
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

main().then(() => {
  process.exitCode = 0;
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[registration-indexing-diagnostic] ${message}`);
  process.stdout.write(`${JSON.stringify({
    mode: "READ_ONLY",
    finalDiagnosis: { code: "DIAGNOSTIC_FAILED", message },
  }, null, 2)}\n`);
  process.exitCode = 2;
}).finally(async () => {
  if (diagnosticClient) {
    progress("cleanup: releasing database client");
    diagnosticClient.release(true);
    diagnosticClient = undefined;
  }
  if (diagnosticPool) {
    progress("cleanup: closing database pool");
    await withDiagnosticTimeout("database pool shutdown", diagnosticPool.end(), DATABASE_TIMEOUT_MS)
      .catch((error) => progress(error instanceof Error ? error.message : String(error)));
  }
  if (diagnosticProvider) {
    progress("cleanup: destroying RPC provider");
    diagnosticProvider.destroy();
  }
});
