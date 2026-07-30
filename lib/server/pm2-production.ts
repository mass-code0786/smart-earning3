import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { redactDatabaseIdentity } from "./production-environment";

export const PRODUCTION_CWD = "/var/www/smart-earning3";

export type Pm2Process = {
  name?: string;
  pm2_env?: {
    pm_cwd?: string;
    pm_exec_path?: string;
    DATABASE_URL?: string;
    NODE_ENV?: string;
    DEPLOYED_GIT_COMMIT?: string;
    [key: string]: unknown;
  };
};

export function selectProductionPm2Process(
  processes: Pm2Process[],
  expectedCwd = PRODUCTION_CWD,
) {
  const matches = processes.filter((process) =>
    process.name === "smart-earning"
    && process.pm2_env?.pm_cwd === expectedCwd);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one smart-earning PM2 process with cwd ${expectedCwd}; found ${matches.length}`,
    );
  }
  const selected = matches[0];
  if (!selected.pm2_env?.DATABASE_URL) {
    throw new Error("Matching PM2 process does not provide DATABASE_URL");
  }
  if (selected.pm2_env.NODE_ENV !== "production") {
    throw new Error("Matching PM2 process is not running with NODE_ENV=production");
  }
  return {
    process: selected,
    databaseUrl: selected.pm2_env.DATABASE_URL,
    databaseIdentity: redactDatabaseIdentity(selected.pm2_env.DATABASE_URL),
  };
}

export function readPm2Processes(): Pm2Process[] {
  const output = execFileSync("pm2", ["jlist"], { encoding: "utf8" });
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) throw new Error("PM2 returned an invalid process list");
  return parsed as Pm2Process[];
}

export function deployedCheckoutCommit(cwd = PRODUCTION_CWD) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: resolve(cwd),
    encoding: "utf8",
  }).trim();
}
