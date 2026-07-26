const hre = require("hardhat");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

async function main() {
  if (hre.network.config.chainId !== 97) {
    throw new Error("Deployment is restricted to BNB Smart Chain Testnet (chainId 97)");
  }

  const usdt = process.env.BSC_TESTNET_USDT_ADDRESS;
  const genesis = process.env.GENESIS_WALLET;
  const treasury = process.env.TREASURY_WALLET;
  const authorizer = process.env.WITHDRAWAL_AUTHORIZER_ADDRESS;
  if (!usdt || !genesis || !treasury || !authorizer) {
    throw new Error("BSC_TESTNET_USDT_ADDRESS, GENESIS_WALLET, TREASURY_WALLET and WITHDRAWAL_AUTHORIZER_ADDRESS are required");
  }

  const [deployer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractFactory("SmartEarning");
  const contract = await factory.deploy(usdt, genesis, deployer.address, treasury, authorizer);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const deployment = {
    network: "bscTestnet",
    chainId: 97,
    address: await contract.getAddress(),
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    usdt,
    genesis,
    treasury,
    authorizer,
  };
  await writeFile(resolve("deployments", "bsc-testnet.json"), JSON.stringify(deployment, null, 2));
  process.stdout.write(`${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
