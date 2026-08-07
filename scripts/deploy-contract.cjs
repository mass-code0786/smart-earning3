const hre = require("hardhat");
const { writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const EXPECTED_DEPLOYER = hre.ethers.getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (hre.network.name !== "bscTestnet" || Number(network.chainId) !== 97) {
    throw new Error("Deployment is restricted to BNB Smart Chain Testnet (chainId 97)");
  }
  if (process.env.SMART_EARNING_DEPLOY_CONFIRM !== "DEPLOY_PACKAGE_ONLY_CAP_TESTNET") {
    throw new Error("SMART_EARNING_DEPLOY_CONFIRM=DEPLOY_PACKAGE_ONLY_CAP_TESTNET is required");
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required");
  let derivedDeployer;
  try {
    derivedDeployer = hre.ethers.getAddress(
      new hre.ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).address,
    );
  } catch {
    throw new Error("DEPLOYER_PRIVATE_KEY is invalid");
  }
  if (derivedDeployer !== EXPECTED_DEPLOYER) {
    throw new Error("DEPLOYER_PRIVATE_KEY does not derive the expected deployer address");
  }

  const usdt = process.env.BSC_TESTNET_USDT_ADDRESS;
  const genesis = process.env.GENESIS_WALLET;
  const treasury = process.env.TREASURY_WALLET;
  const authorizer = process.env.WITHDRAWAL_AUTHORIZER_ADDRESS;
  if (!usdt || !genesis || !treasury || !authorizer) {
    throw new Error("BSC_TESTNET_USDT_ADDRESS, GENESIS_WALLET, TREASURY_WALLET and WITHDRAWAL_AUTHORIZER_ADDRESS are required");
  }

  const [deployer] = await hre.ethers.getSigners();
  if (hre.ethers.getAddress(deployer.address) !== EXPECTED_DEPLOYER) {
    throw new Error("Hardhat signer does not match the expected deployer address");
  }
  const factory = await hre.ethers.getContractFactory("SmartEarning");
  const contract = await factory.deploy(usdt, genesis, deployer.address, treasury, authorizer);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const contractAddress = await contract.getAddress();
  const deployedBytecodeHash = hre.ethers.keccak256(await hre.ethers.provider.getCode(contractAddress));
  const deployment = {
    network: "bscTestnet",
    chainId: 97,
    policy: "PACKAGE_ONLY_5X_V1",
    alignment: "DIRECT_REFERRAL_X3_V1",
    rolloutMode: "TRANSITIONAL",
    deployer: EXPECTED_DEPLOYER,
    address: contractAddress,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    usdt,
    genesis,
    treasury,
    authorizer,
    deployedBytecodeHash,
  };
  await Promise.all([
    writeFile(resolve("deployments", "bsc-testnet.json"), JSON.stringify(deployment, null, 2)),
    writeFile(resolve("deployments", "bsc-testnet-x3-aligned.json"), JSON.stringify(deployment, null, 2)),
  ]);
  process.stdout.write(`${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
