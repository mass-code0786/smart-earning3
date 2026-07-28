const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { getAddress } = require("ethers");
const hre = require("hardhat");

async function main() {
  if (Number((await hre.ethers.provider.getNetwork()).chainId) !== 97) {
    throw new Error("Verification is restricted to BSC Testnet (chain ID 97)");
  }
  if (!process.env.BSCSCAN_API_KEY) throw new Error("BSCSCAN_API_KEY is required");
  const deployment = JSON.parse(
    await readFile(resolve("deployments", "bsc-testnet-mock-usdt.json"), "utf8"),
  );
  const configured = getAddress(process.env.BSC_TESTNET_USDT_ADDRESS || deployment.address);
  if (configured !== getAddress(deployment.address)) throw new Error("Mock USDT address mismatch");
  await hre.run("verify:verify", { address: configured, constructorArguments: [] });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Mock USDT verification failed"}\n`);
  process.exitCode = 1;
});
