import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deployedCheckoutCommit, readPm2Processes, selectProductionPm2Process,
} from "../lib/server/pm2-production";
import {
  verifyLiveIndexerLogs, verifyLiveIndexerSources, verifyNextArtifacts,
} from "../lib/server/production-deployment";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EXPECTED_NGINX_UPSTREAM_PORT,
  requireProductionPort,
} = require("./production-port.cjs") as {
  EXPECTED_NGINX_UPSTREAM_PORT: string;
  requireProductionPort: (environment: Record<string, string | undefined>) => string;
};

function main() {
  const selected = selectProductionPm2Process(readPm2Processes());
  const cwd = selected.process.pm2_env?.pm_cwd;
  if (!cwd) throw new Error("PM2 process does not provide cwd");
  const port = requireProductionPort({
    PORT: selected.process.pm2_env?.PORT,
  });
  const artifacts = verifyNextArtifacts(cwd);
  verifyLiveIndexerSources(cwd);
  const commit = deployedCheckoutCommit(cwd);
  if (selected.process.pm2_env?.DEPLOYED_GIT_COMMIT !== commit) {
    throw new Error("Running PM2 commit does not match its release checkout");
  }
  if (selected.process.pm2_env?.DEPLOYED_BUILD_ID !== artifacts.buildId) {
    throw new Error("Running PM2 build ID does not match its release");
  }
  const expectedScript = resolve(cwd, "node_modules/next/dist/bin/next");
  if (resolve(String(selected.process.pm2_env?.pm_exec_path || "")) !== expectedScript) {
    throw new Error("Running PM2 script path does not match its release");
  }
  const startedAtMs = Number(selected.process.pm2_env?.pm_uptime || 0);
  if (startedAtMs <= artifacts.completedAtMs) {
    throw new Error("PM2 process did not start after the final build artifact");
  }
  const logs = execFileSync(
    "pm2", ["logs", "smart-earning", "--nostream", "--lines", "200"],
    { cwd, encoding: "utf8" },
  );
  verifyLiveIndexerLogs(logs);
  process.stdout.write(`${JSON.stringify({
    name: selected.process.name,
    cwd,
    nodeEnv: selected.process.pm2_env?.NODE_ENV,
    hasDatabaseUrl: Boolean(selected.process.pm2_env?.DATABASE_URL),
    port,
    nginxUpstreamPort: EXPECTED_NGINX_UPSTREAM_PORT,
    commit,
    buildId: readFileSync(resolve(cwd, ".next/BUILD_ID"), "utf8").trim(),
    processStartedAfterBuild: true,
    indexerMode: "block_receipt_indexing",
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(
    `[production-runtime] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
