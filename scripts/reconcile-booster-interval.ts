import { reconcileLegacyBoosterInterval } from "../lib/server/booster-interval-reconciliation";
import { classifyDatabaseError, getPool } from "../lib/server/db";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";

const args = process.argv.slice(2);
const apply = args.includes("--apply");

async function main() {
  if (apply && !args.includes("--confirm-production-database")) {
    throw new Error("Apply refused without --confirm-production-database");
  }
  const environment = loadAuthoritativeEnvironment(process.cwd());
  const reconciliation = await reconcileLegacyBoosterInterval(!apply);
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    database: environment.databaseIdentity,
    affectedRows: reconciliation.affectedRows,
    examples: reconciliation.examples,
  }, null, 2)}\n`);
  if (!apply) process.stdout.write("Dry run only; no Booster schedules were changed.\n");
  await getPool().end();
}

main().catch(async error => {
  const diagnostic = classifyDatabaseError(error);
  console.error(`[database:${diagnostic.databaseCode}] ${diagnostic.message}`);
  await getPool().end().catch(() => undefined);
  process.exitCode = 1;
});
