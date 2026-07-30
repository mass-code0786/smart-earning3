import {
  PRODUCTION_CWD,
  readPm2Processes,
  selectProductionPm2Process,
} from "../lib/server/pm2-production";

function main() {
  const selected = selectProductionPm2Process(readPm2Processes());
  process.stdout.write(`${JSON.stringify({
    name: selected.process.name,
    cwd: selected.process.pm2_env?.pm_cwd,
    nodeEnv: selected.process.pm2_env?.NODE_ENV,
    hasDatabaseUrl: Boolean(selected.process.pm2_env?.DATABASE_URL),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(
    `[pm2-environment-check] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
