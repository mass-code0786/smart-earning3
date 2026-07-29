import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--tx="));
  const txHash = argument?.slice("--tx=".length);
  const apply = process.argv.includes("--apply");
  if (!txHash) {
    throw new Error("Usage: npm run reconcile:registration:testnet -- --tx=0x...");
  }

  const [{ reconcileRegistrationTransaction }, { getPool }] = await Promise.all([
    import("../lib/server/registration-tx-reconciliation"),
    import("../lib/server/db"),
  ]);
  try {
    const validation = await reconcileRegistrationTransaction(txHash, { dryRun: true });
    process.stdout.write(`${JSON.stringify({ phase: "DRY_RUN", ...validation }, null, 2)}\n`);
    if (!apply) {
      process.stdout.write("Dry run only. Re-run with --apply to reconcile missing off-chain records.\n");
      return;
    }
    const result = await reconcileRegistrationTransaction(txHash);
    process.stdout.write(`${JSON.stringify({ phase: "APPLY", ...result }, null, 2)}\n`);
  } finally {
    await getPool().end();
  }
}

main().catch((error: unknown) => {
  const candidate = error as { code?: string; message?: string };
  console.error(`[registration-reconciliation:${candidate.code || "ERROR"}] ${candidate.message || "Failed"}`);
  process.exitCode = 1;
});
