const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { getAddress } = require("ethers");
const hre = require("hardhat");

const EXPECTED_DEPLOYER = getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");

function address(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid checksummed address`);
  }
}

async function main() {
  if (Number((await hre.ethers.provider.getNetwork()).chainId) !== 97) {
    throw new Error("Verification is restricted to BSC Testnet (chain ID 97)");
  }
  if (!process.env.BSCSCAN_API_KEY) throw new Error("BSCSCAN_API_KEY is required");
  const deployment = JSON.parse(await readFile(resolve("deployments", "bsc-testnet.json"), "utf8"));
  const smart = address("SMART_EARNING_CONTRACT_ADDRESS");
  const usdt = address("BSC_TESTNET_USDT_ADDRESS");
  const genesis = address("GENESIS_WALLET");
  const treasury = address("TREASURY_WALLET");
  const authorizer = address("WITHDRAWAL_AUTHORIZER_ADDRESS");
  const deployer = EXPECTED_DEPLOYER;
  if (getAddress(deployment.address) !== smart) throw new Error("Smart Earning metadata address mismatch");

  await hre.run("verify:verify", {
    address: smart,
    constructorArguments: [usdt, genesis, deployer, treasury, authorizer],
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Smart Earning verification failed"}\n`);
  process.exitCode = 1;
});
