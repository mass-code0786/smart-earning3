import { loadEnvConfig } from "@next/env";
import { getPool } from "../lib/server/db";

loadEnvConfig(process.cwd());
const value = (name: string) => process.argv.slice(2)
  .find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const sponsor = value("sponsor");
  const referral = value("referral");
  const apply = process.argv.includes("--apply");
  if (!sponsor || !referral) {
    throw new Error(
      "Usage: npm run repair:user-ownership:testnet -- --sponsor=0x... --referral=0x... [--apply]",
    );
  }
  const { repairUserOwnership } = await import("../lib/server/user-ownership-repair");
  try {
    const result = await repairUserOwnership({ sponsor, referral, apply });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!apply) process.stdout.write("Dry run only. Re-run with --apply after reviewing every proposed row.\n");
  } finally {
    await getPool().end();
  }
}

main().catch((error) => {
  console.error(`[user-ownership-repair] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
