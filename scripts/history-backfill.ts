import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { backfillHistory } from "../lib/server/history-backfill-service";
import { getPool } from "../lib/server/db";

loadAuthoritativeEnvironment(process.cwd());
const args = process.argv.slice(2);
const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.split("=",2)[1] || null;

async function main() {
  const result = await backfillHistory({
    dryRun: args.includes("--dry-run"),
    batchSize: Number(value("batch-size") || 500),
    category: value("category"),
  });
  console.log(result.dryRun ? "History backfill dry run" : "History backfill completed");
  for (const [category, count] of Object.entries(result.counts)) {
    console.log(`${category}: candidates=${count.candidates} inserted=${count.inserted}`);
  }
  await getPool().end();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "History backfill failed");
  process.exitCode = 1;
});
