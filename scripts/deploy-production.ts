import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRODUCTION_CWD, PRODUCTION_RELEASES_CWD, readPm2Processes,
  selectProductionPm2Process,
} from "../lib/server/pm2-production";
import {
  verifyLiveIndexerLogs, verifyLiveIndexerSources, verifyNextArtifacts,
} from "../lib/server/production-deployment";

const require = createRequire(import.meta.url);
const { loadProductionPm2Environment } = require("./pm2-environment.cjs") as {
  loadProductionPm2Environment: (
    path: string,
    environment?: Record<string, string | undefined>,
  ) => Record<string, string | undefined>;
};
const { requireProductionPort } = require("./production-port.cjs") as {
  requireProductionPort: (environment: Record<string, string | undefined>) => string;
};

const CONFIRM = "--confirm-production-deploy";
const PM2_APPS = ["smart-earning","smart-earning-indexer","smart-earning-x3-recovery","smart-earning-x3-hold-expiry","smart-earning-booster","smart-earning-dividend","smart-earning-withdrawal","smart-earning-magic-funding","smart-earning-magic-distribution"];
type Stage = { name: string; run: () => void | Promise<void> };

function command(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
) {
  const result = spawnSync(command, args, {
    cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function output(commandName: string, args: string[], cwd: string) {
  return execFileSync(commandName, args, { cwd, encoding: "utf8" }).trim();
}

async function waitForHttpHealth(url: string, attempts = 30) {
  let lastStatus = "unreachable";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      lastStatus = String(response.status);
      if (response.ok) return;
    } catch {
      lastStatus = "unreachable";
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`Local HTTP health failed; last status=${lastStatus}`);
}

async function main() {
  if (!process.argv.includes(CONFIRM)) {
    throw new Error(`Refusing production deployment without ${CONFIRM}`);
  }
  if (resolve(process.cwd()).replaceAll("\\", "/") !== PRODUCTION_CWD) {
    throw new Error(`Production deployment must run from ${PRODUCTION_CWD}`);
  }

  const commit = output("git", ["rev-parse", "HEAD"], PRODUCTION_CWD);
  const branch = output("git", ["branch", "--show-current"], PRODUCTION_CWD);
  const releaseCwd = resolve(PRODUCTION_RELEASES_CWD, `${commit}-${Date.now()}`);
  const previous = (() => {
    try { return selectProductionPm2Process(readPm2Processes()); } catch { return null; }
  })();
  let switched = false;
  let buildId = "";
  let completedAtMs = 0;
  let productionEnvironment: Record<string, string | undefined> = {};
  let productionPort = "";

  const stages: Stage[] = [
    { name: "clean_worktree", run: () => {
      if (output("git", ["status", "--porcelain"], PRODUCTION_CWD)) {
        throw new Error("Production checkout has uncommitted changes");
      }
    } },
    { name: "git_identity", run: () => {
      if (!branch) throw new Error("Detached HEAD is not deployable");
      process.stdout.write(`[deploy] branch=${branch} commit=${commit}\n`);
    } },
    { name: "production_environment", run: () => {
      productionEnvironment = loadProductionPm2Environment(
        resolve(PRODUCTION_CWD, ".env"),
      );
      if (!productionEnvironment.DATABASE_URL) throw new Error("DATABASE_URL is missing");
      productionPort = requireProductionPort(productionEnvironment);
      process.stdout.write(
        `[deploy] production environment resolved; hasDatabaseUrl=true port=${productionPort}\n`,
      );
    } },
    { name: "create_isolated_release", run: () => {
      mkdirSync(PRODUCTION_RELEASES_CWD, { recursive: true });
      command("git", ["worktree", "add", "--detach", releaseCwd, commit], PRODUCTION_CWD);
    } },
    { name: "release_source", run: () => {
      const deployment = resolve(releaseCwd, "deployments/bsc-testnet.json");
      if (!existsSync(deployment)) {
        throw new Error("Release is missing deployments/bsc-testnet.json");
      }
    } },
    { name: "npm_ci", run: () => command("npm", ["ci", "--include=dev"], releaseCwd) },
    { name: "typecheck", run: () => command(
      "npm", ["run", "typecheck"], releaseCwd, productionEnvironment,
    ) },
    { name: "production_build", run: () => command("npm", ["run", "build"], releaseCwd, {
      ...productionEnvironment, NEXT_TELEMETRY_DISABLED: "1",
    }) },
    { name: "next_artifacts", run: () => {
      const verified = verifyNextArtifacts(releaseCwd);
      buildId = verified.buildId;
      completedAtMs = verified.completedAtMs;
    } },
    { name: "live_indexer_source", run: () => verifyLiveIndexerSources(releaseCwd) },
    { name: "pre_migration_backup", run: () => command("bash", ["ops/postgres-backup.sh"], releaseCwd, productionEnvironment) },
    { name: "database_migrations", run: () => command(process.execPath,
      [resolve(releaseCwd,"node_modules/tsx/dist/cli.mjs"),resolve(releaseCwd,"scripts/migrate.ts")],releaseCwd,
      {...productionEnvironment,NODE_ENV:"production",PRODUCTION_DATABASE_SOURCE:"validated-deploy"}) },
    { name: "prune_development_dependencies", run: () => command("npm",["prune","--omit=dev"],releaseCwd) },
    { name: "pm2_reload", run: () => {
      command("pm2", ["startOrReload", resolve(releaseCwd, "ecosystem.config.cjs"),
        "--update-env"], releaseCwd, {
        ...process.env, SMART_EARNING_RELEASE_CWD: releaseCwd,
      });
      switched = true;
    } },
    { name: "pm2_save", run: () => command("pm2", ["save"], releaseCwd) },
    { name: "runtime_identity", run: () => {
      const processes=readPm2Processes();
      for(const name of PM2_APPS){const matches=processes.filter(process=>process.name===name&&resolve(String(process.pm2_env?.pm_cwd||""))===resolve(releaseCwd));if(matches.length!==1)throw new Error(`Expected exactly one ${name} process; found ${matches.length}`)}
      const selected = selectProductionPm2Process(readPm2Processes(), releaseCwd);
      const env = selected.process.pm2_env;
      if (env?.NODE_ENV !== "production" || !env.DATABASE_URL) {
        throw new Error("Running PM2 environment is incomplete");
      }
      if (env.PORT !== productionPort) throw new Error("Running PM2 port mismatch");
      if (env.BLOCKCHAIN_INDEXER_MODE !== "block_receipt_indexing") {
        throw new Error("Running PM2 indexer mode mismatch");
      }
      if (env.DEPLOYED_GIT_COMMIT !== commit) throw new Error("Running commit mismatch");
      if (env.DEPLOYED_BUILD_ID !== buildId) throw new Error("Running build ID mismatch");
      const pid = selected.process.pid;
      if (!pid) throw new Error("PM2 did not provide a running PID");
      const startedAtMs = Number(env.pm_uptime || 0);
      if (startedAtMs <= completedAtMs) {
        throw new Error("Running process did not start after the completed build");
      }
      const runningBuildId = readFileSync(resolve(releaseCwd, ".next/BUILD_ID"), "utf8").trim();
      if (runningBuildId !== buildId) throw new Error("Running build ID mismatch");
      const expectedScript = resolve(releaseCwd, "node_modules/next/dist/bin/next");
      if (resolve(String(env.pm_exec_path || "")) !== expectedScript) {
        throw new Error("Running PM2 script path mismatch");
      }
    } },
    { name: "database_readiness", run: () =>
      command("npm", ["run", "verify:production-readiness"], releaseCwd) },
    { name: "http_health", run: () =>
      waitForHttpHealth(`http://127.0.0.1:${productionPort}/api/health/ready`) },
    { name: "indexer_health_mode", run: async () => {
      const logs = output("pm2", ["logs", "smart-earning-indexer",
        "--nostream", "--lines", "200"], releaseCwd);
      const verification = verifyLiveIndexerLogs(logs);
      process.stdout.write(
        `[deploy] indexer mode=block_receipt_indexing` +
        ` startupMarkerInRecentLogs=${verification.markerObserved}\n`,
      );
    } },
    { name: "mark_release_success", run: () => {
      writeFileSync(resolve(releaseCwd, ".deployment-success.json"), JSON.stringify({
        commit,
        buildId,
        completedAt: new Date().toISOString(),
      }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    } },
  ];

  try {
    for (const stage of stages) {
      process.stdout.write(`[deploy] ${stage.name}: START\n`);
      await stage.run();
      process.stdout.write(`[deploy] ${stage.name}: PASS\n`);
    }
  } catch (error) {
    process.stderr.write(`[deploy] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    if (switched && previous?.process.pm2_env?.pm_cwd) {
      const previousCwd = previous.process.pm2_env.pm_cwd;
      process.stderr.write("[deploy] rollback_previous_release: START\n");
      command("pm2", ["startOrReload", resolve(previousCwd, "ecosystem.config.cjs"),
        "--update-env"], previousCwd, {
        ...process.env, SMART_EARNING_RELEASE_CWD: previousCwd,
      });
      command("pm2", ["save"], previousCwd);
      process.stderr.write("[deploy] rollback_previous_release: PASS\n");
    }
    throw error;
  }
}

main().catch(() => {
  process.exitCode = 2;
});
