import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { startBlockchainIndexer, stopBlockchainIndexer } from "../lib/server/blockchain-indexer";
import { getPool } from "../lib/server/db";

loadAuthoritativeEnvironment(process.cwd());

async function main() {
  startBlockchainIndexer();
  const shutdown = async () => {
    stopBlockchainIndexer();
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
