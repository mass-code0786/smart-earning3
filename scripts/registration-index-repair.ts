import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "../lib/blockchain/abi";
import { smartEarningDeployment } from "../lib/blockchain/deployment-metadata";
import { indexerRpcUrls, ReadOnlyIndexerRpc } from "../lib/blockchain/indexer-rpc";
import { getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { verifyAndActivateRegistration } from "../lib/server/registration-service";

loadAuthoritativeEnvironment(process.cwd());

type EventProjection = {
  wallet: string; sponsor: string; matrixParent: string;
  matrixIndex: string; matrixPosition: number;
  transactionHash: string; blockNumber: number; logIndex: number;
};

function integerFlag(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${prefix}<block> is invalid`);
  return parsed;
}

async function snapshot(events: EventProjection[]) {
  const pool = getPool();
  const database = await pool.query<{
    wallet: string; sponsor: string; matrix_parent: string | null;
    matrix_index: string | null; matrix_position: number | null;
  }>(
    `SELECT u.wallet_address wallet,s.wallet_address sponsor,p.wallet_address matrix_parent,
            mp.contract_matrix_index::text matrix_index,mp.position matrix_position
     FROM registrations r JOIN users u ON u.id=r.user_id
     JOIN users s ON s.id=r.sponsor_user_id
     LEFT JOIN matrix_placements mp ON mp.registration_id=r.id
     LEFT JOIN users p ON p.id=mp.parent_user_id
     WHERE r.status='CONFIRMED'`,
  );
  const byWallet = new Map(database.rows.map((row) => [row.wallet, row]));
  const missing = events.filter((event) => !byWallet.has(event.wallet));
  const missingPlacements = events.filter((event) => !byWallet.get(event.wallet)?.matrix_parent);
  const conflicting = events.filter((event) => {
    const row = byWallet.get(event.wallet);
    return row && (
      row.sponsor !== event.sponsor || row.matrix_parent !== event.matrixParent
      || row.matrix_index !== event.matrixIndex || row.matrix_position !== event.matrixPosition
    );
  });
  const orphan = await pool.query<{ count: string }>(
    `SELECT count(*)::text count FROM matrix_placements mp
     LEFT JOIN users p ON p.id=mp.parent_user_id
     WHERE mp.parent_user_id IS NOT NULL AND p.id IS NULL`,
  );
  const unprocessed = await pool.query<{ count: string }>(
    `SELECT count(*)::text count FROM (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
       AS x("transactionHash" text,"logIndex" integer)
     ) e LEFT JOIN blockchain_processed_events p
       ON p.chain_id=$2 AND p.transaction_hash=lower(e."transactionHash")
      AND p.log_index=e."logIndex" WHERE p.id IS NULL`,
    [JSON.stringify(events), smartEarningDeployment().chainId],
  );
  const checkpoint = await pool.query<{ last_processed_block: string }>(
    `SELECT last_processed_block::text FROM blockchain_indexer_state
     WHERE chain_id=$1 AND contract_address=$2`,
    [smartEarningDeployment().chainId, smartEarningDeployment().address],
  );
  return {
    configuredDeploymentBlock: smartEarningDeployment().blockNumber,
    currentCheckpoint: checkpoint.rows[0]?.last_processed_block
      ? Number(checkpoint.rows[0].last_processed_block) : null,
    earliestRegistrationEvent: events[0]?.blockNumber ?? null,
    latestRegistrationEvent: events.at(-1)?.blockNumber ?? null,
    onChainRegistrations: events.length,
    databaseRegistrations: database.rowCount,
    missingRegistrations: missing.map((event) => event.wallet),
    missingBinaryPlacements: missingPlacements.map((event) => event.wallet),
    conflictingPlacements: conflicting.map((event) => ({
      wallet: event.wallet, expected: event, actual: byWallet.get(event.wallet),
    })),
    orphanMatrixParents: Number(orphan.rows[0]?.count || 0),
    unprocessedRegistrationEvents: Number(unprocessed.rows[0]?.count || 0),
  };
}

async function main() {
  const deployment = smartEarningDeployment();
  const apply = process.argv.includes("--apply");
  const provider = new ReadOnlyIndexerRpc(indexerRpcUrls());
  const network = await provider.getChainId();
  if (network !== deployment.chainId) throw new Error("RPC chain conflicts with deployment metadata");
  const fromBlock = integerFlag("from-block") ?? deployment.blockNumber;
  const latest = await provider.getBlockNumber();
  const toBlock = integerFlag("to-block") ?? latest;
  if (fromBlock < deployment.blockNumber || toBlock < fromBlock || toBlock > latest) {
    throw new Error("Repair block range is outside the deployment-to-latest range");
  }
  const iface = new Interface(SMART_EARNING_ABI);
  const events: EventProjection[] = [];
  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
    const block = await provider.getBlockWithTransactions(blockNumber);
    const transactions = block.transactions
      .filter((transaction) => transaction.to?.toLowerCase() === deployment.address)
      .sort((a, b) => (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0));
    for (const transaction of transactions) {
      const receipt = await provider.getTransactionReceipt(transaction.hash);
      if (receipt.status !== 1) continue;
      for (const entry of receipt.logs.sort((a, b) => a.index - b.index)) {
        if (entry.address.toLowerCase() !== deployment.address) continue;
        let parsed;
        try { parsed = iface.parseLog(entry); } catch { continue; }
        if (!parsed || parsed.name !== "UserRegistered") continue;
        events.push({
          wallet: String(parsed.args.user).toLowerCase(),
          sponsor: String(parsed.args.sponsor).toLowerCase(),
          matrixParent: String(parsed.args.matrixParent).toLowerCase(),
          matrixIndex: String(parsed.args.matrixIndex),
          matrixPosition: Number(parsed.args.matrixPosition),
          transactionHash: entry.transactionHash.toLowerCase(),
          blockNumber: entry.blockNumber,
          logIndex: entry.index,
        });
      }
    }
  }
  const before = await snapshot(events);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", range: { fromBlock, toBlock }, before }, null, 2)}\n`);
    await getPool().end();
    return;
  }
  const lock = await getPool().connect();
  try {
    const owned = await lock.query<{ owned: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1),$2) owned",
      ["smart-earning-registration-repair", deployment.chainId],
    );
    if (!owned.rows[0]?.owned) throw new Error("Another registration repair owns the advisory lock");
    for (const event of events) {
      await verifyAndActivateRegistration(event.wallet, event.transactionHash);
      await getPool().query(
        `INSERT INTO blockchain_processed_events(
           chain_id,contract_address,transaction_hash,log_index,block_number,event_name
         ) VALUES($1,$2,$3,$4,$5,'UserRegistered')
         ON CONFLICT(chain_id,transaction_hash,log_index) DO NOTHING`,
        [
          deployment.chainId, deployment.address, event.transactionHash,
          event.logIndex, event.blockNumber,
        ],
      );
    }
    const after = await snapshot(events);
    process.stdout.write(`${JSON.stringify({
      mode: "apply", range: { fromBlock, toBlock }, before, after,
    }, null, 2)}\n`);
  } finally {
    await lock.query(
      "SELECT pg_advisory_unlock(hashtext($1),$2)",
      ["smart-earning-registration-repair", deployment.chainId],
    ).catch(() => undefined);
    lock.release();
  }
  await getPool().end();
}

main().catch(async (error) => {
  console.error(`[registration-index-repair] ${error instanceof Error ? error.message : String(error)}`);
  await getPool().end().catch(() => undefined);
  process.exitCode = 1;
});
