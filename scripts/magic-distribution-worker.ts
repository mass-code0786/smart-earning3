import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { getPool } from "../lib/server/db";
import { runMagicDistributionScheduler, withDistributionWorkerLock } from "../lib/server/distribution-service";
import { isModulePaused } from "../lib/server/module-control-service";
import { operationsInstance, recordHeartbeat } from "../lib/server/operations-service";

loadAuthoritativeEnvironment(process.cwd());
const name = "magic-distribution-worker";
const instance = operationsInstance(name);
const seconds = Math.max(30, Number(process.env.MAGIC_DISTRIBUTION_WORKER_INTERVAL_SECONDS || 60));
let active: Promise<unknown> | null = null;
let stopping = false;

async function run() {
  if (await isModulePaused("MAGIC_DISTRIBUTION_WORKER")) {
    return recordHeartbeat({ workerName: name, instanceId: instance, status: "PAUSED", intervalSeconds: seconds });
  }
  try {
    const result = await withDistributionWorkerLock(() => runMagicDistributionScheduler());
    const processed = result && "processed" in result ? Number(result.processed || 0) : 0;
    const failed = result && "failed" in result ? Number(result.failed || 0) : 0;
    await recordHeartbeat({ workerName: name, instanceId: instance, status: failed ? "DEGRADED" : "IDLE", intervalSeconds: seconds, processed, failed, metadata: { lockOwned: Boolean(result), cycleResult: result || null } });
    if (result) process.stdout.write(`${JSON.stringify({ scope: "Magic Distribution", result })}\n`);
  } catch (error) {
    await recordHeartbeat({ workerName: name, instanceId: instance, status: "FAILED", intervalSeconds: seconds, failed: 1, error });
    console.error(error);
  }
}

async function execute() {
  if (active || stopping) return;
  active = run();
  try { await active; } finally { active = null; }
}

async function main() {
  await recordHeartbeat({ workerName: name, instanceId: instance, status: "STARTING", intervalSeconds: seconds });
  await execute();
  const timer = setInterval(() => void execute(), seconds * 1000);
  async function stop() {
    if (stopping) return;
    stopping = true; clearInterval(timer); await active?.catch(() => undefined);
    await recordHeartbeat({ workerName: name, instanceId: instance, status: "STOPPED", intervalSeconds: seconds });
    await getPool().end().catch(() => undefined); process.exit(0);
  }
  process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop());
}

main().catch(error => { console.error(error); process.exit(1); });
