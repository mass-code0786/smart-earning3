const { execFileSync } = require("node:child_process");

const cwd = "/var/www/smart-earning3";
if (!process.env.DATABASE_URL) {
  throw new Error("PM2 startup refused: DATABASE_URL must be set in the process environment");
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
      NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL,
      DEPLOYED_GIT_COMMIT: deployedCommit,
    },
  }],
};
