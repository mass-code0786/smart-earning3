import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  PRODUCTION_CWD, readPm2Processes, selectProductionPm2Process,
} from "../lib/server/pm2-production";

if (!process.argv.includes("--confirm-production-database")) {
  throw new Error(
    "Refusing production migration without --confirm-production-database",
  );
}

const selected = selectProductionPm2Process(readPm2Processes());
const runningCwd = selected.process.pm2_env?.pm_cwd;
if (!runningCwd) throw new Error("Matching PM2 process does not provide pm_cwd");
process.stdout.write(
  `Confirmed PM2 migration target: ${JSON.stringify(selected.databaseIdentity)}\n`,
);

const tsxCli = resolve(runningCwd, "node_modules", "tsx", "dist", "cli.mjs");
const migrationScript = resolve(runningCwd, "scripts", "migrate.ts");
const pm2Environment = Object.fromEntries(
  Object.entries(selected.process.pm2_env || {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
const result = spawnSync(process.execPath, [tsxCli, migrationScript], {
  cwd: runningCwd,
  stdio: "inherit",
  env: {
    ...process.env,
    ...pm2Environment,
    NODE_ENV: "production",
    DATABASE_URL: selected.databaseUrl,
    PRODUCTION_DATABASE_SOURCE: "pm2",
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
