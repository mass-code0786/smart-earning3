import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { startBlockchainIndexer, stopBlockchainIndexer } from "../lib/server/blockchain-indexer";
import { getPool } from "../lib/server/db";
import { blockchainIndexerHealth } from "../lib/server/blockchain-indexer";
import { operationsInstance, recordHeartbeat } from "../lib/server/operations-service";

loadAuthoritativeEnvironment(process.cwd());

async function main() {
  const name = "blockchain-indexer", seconds = 30;
  const instance = operationsInstance(name);
  await recordHeartbeat({ workerName: name, instanceId: instance, status: "STARTING", intervalSeconds: seconds });
  startBlockchainIndexer();
  const heartbeat = setInterval(() => void blockchainIndexerHealth().then((health) =>
    recordHeartbeat({ workerName: name, instanceId: instance, status: health.running && health.lockOwned ? "RUNNING" : "DEGRADED",
      intervalSeconds: seconds, failed: health.lastError ? 1 : 0, error: health.lastError || undefined,
      metadata: { lockOwned: health.lockOwned, blocksBehind: health.blocksBehind, lastSuccessfulScanTime: health.lastSuccessfulScanTime } })),
    seconds * 1000);
  const shutdown = async () => {
    clearInterval(heartbeat);
    stopBlockchainIndexer();
    await recordHeartbeat({ workerName: name, instanceId: instance, status: "STOPPED", intervalSeconds: seconds });
    await getPool().end();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
