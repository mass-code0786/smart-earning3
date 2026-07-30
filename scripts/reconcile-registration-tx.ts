import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import deployment from "../deployments/bsc-testnet.json";

loadAuthoritativeEnvironment(process.cwd());

async function main() {
  const txArgument = process.argv.slice(2).find((value) => value.startsWith("--tx="));
  const walletArgument = process.argv.slice(2).find((value) => value.startsWith("--wallet="));
  let txHash = txArgument?.slice("--tx=".length);
  const wallet = walletArgument?.slice("--wallet=".length);
  const apply = process.argv.includes("--apply");
  if ((!txHash && !wallet) || (txHash && wallet)) {
    throw new Error(
      "Usage: npm run reconcile:registration:testnet -- (--tx=0x... | --wallet=0x...) [--apply]",
    );
  }

  const [{
    findRegistrationTransactionForWallet,
    reconcileRegistrationTransaction,
  }, { getPool }] = await Promise.all([
    import("../lib/server/registration-tx-reconciliation"),
    import("../lib/server/db"),
  ]);
  try {
    if (wallet) {
      const configuredBlock = process.env.SMART_EARNING_DEPLOYMENT_BLOCK;
      const deploymentBlock = configuredBlock === undefined
        ? deployment.blockNumber
        : Number(configuredBlock);
      const resolved = await findRegistrationTransactionForWallet(wallet, { deploymentBlock });
      txHash = resolved.txHash;
      process.stdout.write(`${JSON.stringify({ phase: "EVENT_LOOKUP", ...resolved }, null, 2)}\n`);
    }
    if (!txHash) throw new Error("A registration transaction could not be resolved");
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
