import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { posix, resolve } from "node:path";
import {
  LEGACY_PRODUCTION_RELEASES_CWD,
  PRODUCTION_CWD,
  PRODUCTION_RELEASES_CWD,
  readPm2Processes,
  selectProductionPm2Process,
} from "../lib/server/pm2-production";
import {
  planProductionReleaseCleanup,
  type ProductionRelease,
} from "../lib/server/production-release-cleanup";

const CONFIRM = "--confirm-production-release-cleanup";
const SUCCESS_MARKER = ".deployment-success.json";

function normalized(path: string) {
  return posix.normalize(resolve(path).replaceAll("\\", "/"));
}

function main() {
  if (!process.argv.includes(CONFIRM)) {
    throw new Error(`Refusing release cleanup without ${CONFIRM}`);
  }

  const releaseRoots = [
    normalized(PRODUCTION_RELEASES_CWD),
    normalized(LEGACY_PRODUCTION_RELEASES_CWD),
  ];
  const active = selectProductionPm2Process(readPm2Processes());
  const activeCwd = normalized(String(active.process.pm2_env?.pm_cwd || ""));
  const releases: ProductionRelease[] = releaseRoots.flatMap((releaseRoot) =>
    existsSync(releaseRoot)
      ? readdirSync(releaseRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const cwd = normalized(resolve(releaseRoot, entry.name));
          if (!cwd.startsWith(`${releaseRoot}/`)) {
            throw new Error(`Release escaped configured root: ${cwd}`);
          }
          const marker = resolve(cwd, SUCCESS_MARKER);
          return {
            cwd,
            successful: existsSync(marker),
            modifiedAtMs: statSync(existsSync(marker) ? marker : cwd).mtimeMs,
          };
        })
      : []);

  const removals = planProductionReleaseCleanup(releases, activeCwd);
  process.stdout.write(JSON.stringify({
    activeRelease: activeCwd,
    keepSuccessful: 3,
    removalCount: removals.length,
    removals: removals.map((release) => ({
      cwd: release.cwd,
      successful: release.successful,
    })),
  }, null, 2) + "\n");

  for (const release of removals) {
    if (
      release.cwd === activeCwd
      || !releaseRoots.some((root) => release.cwd.startsWith(`${root}/`))
    ) {
      throw new Error(`Refusing unsafe release removal: ${release.cwd}`);
    }
    const result = spawnSync(
      "git",
      ["worktree", "remove", "--force", release.cwd],
      { cwd: PRODUCTION_CWD, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Failed to remove release ${release.cwd}`);
    }
  }
  execFileSync("git", ["worktree", "prune"], { cwd: PRODUCTION_CWD });
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[release-cleanup] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
