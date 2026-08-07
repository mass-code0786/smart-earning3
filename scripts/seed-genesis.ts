import { transaction, getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { bootstrapGenesis } from "../lib/server/genesis-bootstrap";

loadAuthoritativeEnvironment(process.cwd());
async function main() {
  if (!process.env.GENESIS_WALLET) throw new Error("GENESIS_WALLET is required");
  const result = await transaction((client) => bootstrapGenesis(client, process.env.GENESIS_WALLET!, 2_000_000n));
  await getPool().end();
  process.stdout.write(`Genesis sponsor ${result.status}: ${result.wallet} (root placement verified)\n`);
}

main().catch((error) => {
  console.error(`Genesis bootstrap failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
