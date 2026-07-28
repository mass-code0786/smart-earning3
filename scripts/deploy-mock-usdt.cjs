const { access, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { Wallet, getAddress } = require("ethers");

const EXPECTED_DEPLOYER = getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");
const DEPLOYMENT_FILE = resolve("deployments", "bsc-testnet-mock-usdt.json");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  if (await exists(DEPLOYMENT_FILE) && !force) {
    throw new Error("Mock USDT deployment metadata already exists; pass --force to overwrite it");
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY is required");
  let derivedDeployer;
  try {
    derivedDeployer = getAddress(new Wallet(privateKey).address);
  } catch {
    throw new Error("DEPLOYER_PRIVATE_KEY is invalid");
  }
  if (derivedDeployer !== EXPECTED_DEPLOYER) {
    throw new Error("DEPLOYER_PRIVATE_KEY does not derive the expected deployer address");
  }

  process.env.HARDHAT_NETWORK = "bscTestnet";
  const hre = require("hardhat");
  const network = await hre.ethers.provider.getNetwork();
  if (hre.network.name !== "bscTestnet" || Number(network.chainId) !== 97) {
    throw new Error("Deployment is restricted to BSC Testnet (chain ID 97)");
  }

  const [deployer] = await hre.ethers.getSigners();
  if (getAddress(deployer.address) !== EXPECTED_DEPLOYER) {
    throw new Error("Hardhat signer does not match the expected deployer address");
  }

  const factory = await hre.ethers.getContractFactory("MockUSDT", deployer);
  const contract = await factory.deploy();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error("Mock USDT deployment transaction was not created");
  await contract.waitForDeployment();
  const receipt = await transaction.wait(1);
  const contractAddress = await contract.getAddress();
  const metadata = {
    network: "bscTestnet",
    chainId: 97,
    deployer: EXPECTED_DEPLOYER,
    transactionHash: receipt.hash,
    address: contractAddress,
  };

  await writeFile(DEPLOYMENT_FILE, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: force ? "w" : "wx",
  });
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Mock USDT deployment failed"}\n`);
  process.exitCode = 1;
});
