import { posix } from "node:path";

export type ProductionRelease = {
  cwd: string;
  successful: boolean;
  modifiedAtMs: number;
};

export function planProductionReleaseCleanup(
  releases: ProductionRelease[],
  activeCwd: string,
  nowMs = Date.now(),
  keepSuccessful = 3,
  failedRetentionMs = 24 * 60 * 60 * 1_000,
) {
  const normalizedActive = posix.normalize(activeCwd.replaceAll("\\", "/"));
  const successful = releases
    .filter((release) => release.successful)
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
  const retainedSuccessful = new Set(
    successful.slice(0, Math.max(3, keepSuccessful)).map((release) => release.cwd),
  );

  return releases.filter((release) => {
    const normalized = posix.normalize(release.cwd.replaceAll("\\", "/"));
    if (normalized === normalizedActive) return false;
    if (release.successful) return !retainedSuccessful.has(release.cwd);
    return nowMs - release.modifiedAtMs >= failedRetentionMs;
  });
}
