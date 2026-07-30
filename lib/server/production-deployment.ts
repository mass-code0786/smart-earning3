import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const REQUIRED_NEXT_ARTIFACTS = [
  ".next/BUILD_ID",
  ".next/server/app/page_client-reference-manifest.js",
  ".next/server/pages/500.html",
] as const;

export function verifyNextArtifacts(releaseCwd: string) {
  const missing = REQUIRED_NEXT_ARTIFACTS.filter(
    (file) => !existsSync(resolve(releaseCwd, file)),
  );
  if (missing.length) {
    throw new Error(`Incomplete Next.js build; missing: ${missing.join(", ")}`);
  }
  const buildId = readFileSync(resolve(releaseCwd, ".next/BUILD_ID"), "utf8").trim();
  if (!buildId) throw new Error("Incomplete Next.js build; BUILD_ID is empty");
  return {
    buildId,
    completedAtMs: Math.max(...REQUIRED_NEXT_ARTIFACTS.map(
      (file) => statSync(resolve(releaseCwd, file)).mtimeMs,
    )),
  };
}

export function verifyLiveIndexerSources(releaseCwd: string) {
  const liveFiles = [
    "instrumentation.ts",
    "lib/server/blockchain-indexer.ts",
    "lib/blockchain/indexer-rpc.ts",
    "scripts/indexer-core.ts",
  ];
  for (const file of liveFiles) {
    const source = readFileSync(resolve(releaseCwd, file), "utf8");
    if (/eth_getLogs|\.getLogs\s*\(/.test(source)) {
      throw new Error(`Live indexer contains forbidden eth_getLogs path: ${file}`);
    }
  }
  const reconciliation = readFileSync(
    resolve(releaseCwd, "lib/server/registration-tx-reconciliation.ts"),
    "utf8",
  );
  if (!/\.getLogs\s*\(/.test(reconciliation)) {
    throw new Error("Emergency registration reconciliation no longer has its explicit log lookup");
  }
}

export function verifyLiveIndexerLogs(logs: string) {
  const marker = "block_receipt_indexing";
  const markerIndex = logs.lastIndexOf(marker);
  if (markerIndex < 0) return { markerObserved: false };
  const currentRunLogs = logs.slice(markerIndex);
  if (/method=eth_getLogs/.test(currentRunLogs)) {
    throw new Error("Current live indexer run contains forbidden eth_getLogs activity");
  }
  return { markerObserved: true };
}
