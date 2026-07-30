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
process.stdout.write(
  `Confirmed PM2 migration target: ${JSON.stringify(selected.databaseIdentity)}\n`,
);

const tsxCli = resolve(PRODUCTION_CWD, "node_modules", "tsx", "dist", "cli.mjs");
const migrationScript = resolve(PRODUCTION_CWD, "scripts", "migrate.ts");
const result = spawnSync(process.execPath, [tsxCli, migrationScript], {
  cwd: PRODUCTION_CWD,
  stdio: "inherit",
  env: {
    ...process.env,
    ...selected.process.pm2_env,
    NODE_ENV: "production",
    DATABASE_URL: selected.databaseUrl,
    PRODUCTION_DATABASE_SOURCE: "pm2",
  } as NodeJS.ProcessEnv,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
