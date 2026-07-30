import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { getPool } from "../lib/server/db";

loadAuthoritativeEnvironment(process.cwd());

function argument(name: string) {
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

async function main() {
  const sponsor = argument("sponsor");
  const referral = argument("referral");
  if (!sponsor || !referral) {
    throw new Error(
      "Usage: npm run diagnose:user-ownership:testnet -- --sponsor=0x... --referral=0x...",
    );
  }
  const { diagnoseUserOwnership } = await import("../lib/server/user-ownership-diagnostic");
  try {
    const result = await diagnoseUserOwnership(sponsor, referral);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await getPool().end();
  }
}

main().catch((error) => {
  console.error(`[user-ownership-diagnostic] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
