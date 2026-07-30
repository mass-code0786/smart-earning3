const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  loadProductionPm2Environment,
} = require("./scripts/pm2-environment.cjs");

const projectRoot = "/var/www/smart-earning3";
const cwd = process.env.SMART_EARNING_RELEASE_CWD || projectRoot;
const productionEnvironment = loadProductionPm2Environment(
  resolve(projectRoot, ".env"),
);
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

module.exports = {
  apps: [{
    name: "smart-earning",
    cwd,
    script: "node_modules/next/dist/bin/next",
    args: "start",
    instances: 1,
    exec_mode: "fork",
    env: {
      ...productionEnvironment,
      NODE_ENV: "production",
      DATABASE_URL: productionEnvironment.DATABASE_URL,
      DEPLOYED_GIT_COMMIT: deployedCommit,
      DEPLOYED_BUILD_ID: deployedBuildId,
    },
  }],
};
