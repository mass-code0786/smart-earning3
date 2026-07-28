import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--tx="));
  const txHash = argument?.slice("--tx=".length);
  if (!txHash) {
    throw new Error("Usage: npm run reconcile:registration:testnet -- --tx=0x...");
  }

  const [{ reconcileRegistrationTransaction }, { getPool }] = await Promise.all([
    import("../lib/server/registration-tx-reconciliation"),
    import("../lib/server/db"),
  ]);
  try {
    const result = await reconcileRegistrationTransaction(txHash);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await getPool().end();
  }
}

main().catch((error: unknown) => {
  const candidate = error as { code?: string; message?: string };
  console.error(`[registration-reconciliation:${candidate.code || "ERROR"}] ${candidate.message || "Failed"}`);
  process.exitCode = 1;
});
