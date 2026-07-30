const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");
const {
  loadProductionPm2Environment,
} = require("./scripts/pm2-environment.cjs");

const cwd = "/var/www/smart-earning3";
const productionEnvironment = loadProductionPm2Environment(
  resolve(cwd, ".env"),
);
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
    },
  }],
};
