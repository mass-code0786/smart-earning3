const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  loadProductionPm2Environment,
} = require("./scripts/pm2-environment.cjs");
const { requireProductionPort } = require("./scripts/production-port.cjs");

const projectRoot = "/var/www/smart-earning3";
const cwd = process.env.SMART_EARNING_RELEASE_CWD || projectRoot;
const productionEnvironment = loadProductionPm2Environment(
  resolve(projectRoot, ".env"),
);
const productionPort = requireProductionPort(productionEnvironment);
const requiredArtifacts = [
  ".next/BUILD_ID",
  ".next/server/app/page_client-reference-manifest.js",
  ".next/server/pages/500.html",
];
const missingArtifacts = requiredArtifacts.filter(
  (file) => !existsSync(resolve(cwd, file)),
);
if (missingArtifacts.length) {
  throw new Error(
    `PM2 startup refused: incomplete Next.js build; missing ${missingArtifacts.join(", ")}`,
  );
}
const deployedBuildId = readFileSync(resolve(cwd, ".next/BUILD_ID"), "utf8").trim();
if (!deployedBuildId) {
  throw new Error("PM2 startup refused: .next/BUILD_ID is empty");
}
const deployedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd,
  encoding: "utf8",
}).trim();

const common = {
  cwd,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  restart_delay: 5_000,
  exp_backoff_restart_delay: 100,
  max_restarts: 20,
  min_uptime: "10s",
  kill_timeout: 30_000,
  listen_timeout: 15_000,
  env: {
    ...productionEnvironment,
    NODE_ENV: "production",
    DATABASE_URL: productionEnvironment.DATABASE_URL,
    DEPLOYED_GIT_COMMIT: deployedCommit,
    DEPLOYED_BUILD_ID: deployedBuildId,
    BLOCKCHAIN_INDEXER_MODE: "block_receipt_indexing",
  },
};
const worker = (name, file) => ({
  ...common,
  name,
  script: "node_modules/tsx/dist/cli.mjs",
  args: [file],
});

module.exports = {
  apps: [{
    ...common,
    name: "smart-earning",
    script: "node_modules/next/dist/bin/next",
    args: ["start", "--port", productionPort],
    env: {
      ...common.env,
      PORT: productionPort,
    },
  },
  worker("smart-earning-indexer", "scripts/indexer.ts"),
  worker("smart-earning-x3-recovery", "scripts/x3-recovery-worker.ts"),
  worker("smart-earning-booster", "scripts/booster-worker.ts"),
  worker("smart-earning-dividend", "scripts/dividend-worker.ts"),
  worker("smart-earning-withdrawal", "scripts/withdrawal-worker.ts"),
  worker("smart-earning-magic-funding", "scripts/magic-funding-worker.ts"),
  ],
};
