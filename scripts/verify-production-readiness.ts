import {
  PRODUCTION_CWD, deployedCheckoutCommit, readPm2Processes, selectProductionPm2Process,
} from "../lib/server/pm2-production";

async function main() {
  const selected = selectProductionPm2Process(readPm2Processes());
  const checkoutCommit = deployedCheckoutCommit(PRODUCTION_CWD);
  const runningCommit = selected.process.pm2_env?.DEPLOYED_GIT_COMMIT;
  if (!runningCommit || runningCommit !== checkoutCommit) {
    throw new Error(
      `Running commit mismatch: PM2=${runningCommit || "missing"} checkout=${checkoutCommit}`,
    );
  }
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: selected.databaseUrl,
  });
  const { getRegistrationSchemaReadiness } = await import(
    "../lib/server/registration-schema-readiness"
  );
  const readiness = await getRegistrationSchemaReadiness({ force: true });
  const report = {
    pm2Process: selected.process.name || null,
    cwd: PRODUCTION_CWD,
    gitCommit: checkoutCommit,
    database: selected.databaseIdentity,
    readiness,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!readiness.registrationReady) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[production-readiness] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
