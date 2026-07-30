import { execFileSync } from "node:child_process";
import { posix, resolve } from "node:path";
import { redactDatabaseIdentity } from "./production-environment";

export const PRODUCTION_CWD = "/var/www/smart-earning3";
export const PRODUCTION_RELEASES_CWD = `${PRODUCTION_CWD}/releases`;

export function isProductionReleaseCwd(cwd: string | undefined) {
  if (!cwd) return false;
  const normalized = posix.normalize(cwd.replaceAll("\\", "/"));
  return normalized === PRODUCTION_CWD
    || normalized.startsWith(`${PRODUCTION_RELEASES_CWD}/`);
}

export type Pm2Process = {
  name?: string;
  pid?: number;
  pm2_env?: {
    pm_cwd?: string;
    pm_exec_path?: string;
    DATABASE_URL?: string;
    PORT?: string;
    NODE_ENV?: string;
    DEPLOYED_GIT_COMMIT?: string;
    DEPLOYED_BUILD_ID?: string;
    pm_uptime?: number;
    [key: string]: unknown;
  };
};

export function selectProductionPm2Process(
  processes: Pm2Process[],
  expectedCwd?: string,
) {
  const matches = processes.filter((process) =>
    process.name === "smart-earning"
    && (expectedCwd
      ? posix.normalize((process.pm2_env?.pm_cwd || "").replaceAll("\\", "/"))
        === posix.normalize(expectedCwd.replaceAll("\\", "/"))
      : isProductionReleaseCwd(process.pm2_env?.pm_cwd)));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one smart-earning PM2 process in ${expectedCwd || PRODUCTION_CWD}; found ${matches.length}`,
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
