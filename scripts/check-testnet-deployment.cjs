const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { Contract, JsonRpcProvider, getAddress } = require("ethers");

const EXPECTED_DEPLOYER = getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");
const MOCK_ABI = ["function decimals() view returns (uint8)"];
const SMART_ABI = [
  "function usdt() view returns (address)",
  "function treasuryWallet() view returns (address)",
  "function registered(address) view returns (bool)",
  "function matrixIndexOf(address) view returns (uint256)",
  "function registrationPrice() view returns (uint256)",
  "function totalEligibleValue(address) view returns (uint256)",
  "function totalEarningCap(address) view returns (uint256)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function KEEPER_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function TREASURY_ROLE() view returns (bytes32)",
  "function WITHDRAWAL_EXECUTOR_ROLE() view returns (bytes32)",
  "function AUTHORIZER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name) {
  try {
    return getAddress(required(name));
  } catch {
    throw new Error(`${name} must be a valid checksummed address`);
  }
}

async function metadata() {
  try {
    return JSON.parse(await readFile(resolve("deployments", "bsc-testnet.json"), "utf8"));
  } catch {
    throw new Error("deployments/bsc-testnet.json is missing or invalid");
  }
}

async function main() {
  const provider = new JsonRpcProvider(required("BSC_TESTNET_RPC_URL"));
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) throw new Error(`RPC returned unexpected chain ID ${network.chainId}`);

  const usdtAddress = address("BSC_TESTNET_USDT_ADDRESS");
  const smartAddress = address("SMART_EARNING_CONTRACT_ADDRESS");
  const treasury = address("TREASURY_WALLET");
  const genesis = address("GENESIS_WALLET");
  const authorizer = address("WITHDRAWAL_AUTHORIZER_ADDRESS");
  const deployment = await metadata();

  if (getAddress(deployment.address) !== smartAddress) throw new Error("Smart Earning metadata address mismatch");
  if (getAddress(deployment.usdt) !== usdtAddress) throw new Error("USDT metadata address mismatch");
  if (getAddress(deployment.genesis) !== genesis) throw new Error("Genesis metadata address mismatch");
  if (getAddress(deployment.treasury) !== treasury) throw new Error("Treasury metadata address mismatch");
  if (getAddress(deployment.authorizer) !== authorizer) throw new Error("Authorizer metadata address mismatch");

  if (await provider.getCode(usdtAddress) === "0x") throw new Error("Mock USDT bytecode is missing");
  if (await provider.getCode(smartAddress) === "0x") throw new Error("Smart Earning bytecode is missing");

  const token = new Contract(usdtAddress, MOCK_ABI, provider);
  if (Number(await token.decimals()) !== 6) throw new Error("Mock USDT decimals are not 6");

  const smart = new Contract(smartAddress, SMART_ABI, provider);
  if (getAddress(await smart.usdt()) !== usdtAddress) throw new Error("Smart Earning USDT mismatch");
  if (getAddress(await smart.treasuryWallet()) !== treasury) throw new Error("Smart Earning treasury mismatch");
  if (!await smart.registered(genesis)) throw new Error("Configured genesis wallet is not registered");
  const registrationPrice = await smart.registrationPrice();
  if (
    await smart.matrixIndexOf(genesis) !== 0n ||
    await smart.totalEligibleValue(genesis) !== registrationPrice ||
    await smart.totalEarningCap(genesis) !== registrationPrice * 5n
  ) {
    throw new Error("Configured genesis wallet does not have constructor-initialized state");
  }

  const deployer = EXPECTED_DEPLOYER;

  const roles = {
    defaultAdmin: await smart.DEFAULT_ADMIN_ROLE(),
    keeper: await smart.KEEPER_ROLE(),
    pauser: await smart.PAUSER_ROLE(),
    withdrawalExecutor: await smart.WITHDRAWAL_EXECUTOR_ROLE(),
    treasury: await smart.TREASURY_ROLE(),
    authorizer: await smart.AUTHORIZER_ROLE(),
  };
  const checks = [
    ["deployer DEFAULT_ADMIN_ROLE", await smart.hasRole(roles.defaultAdmin, deployer)],
    ["deployer KEEPER_ROLE", await smart.hasRole(roles.keeper, deployer)],
    ["deployer PAUSER_ROLE", await smart.hasRole(roles.pauser, deployer)],
    ["deployer WITHDRAWAL_EXECUTOR_ROLE", await smart.hasRole(roles.withdrawalExecutor, deployer)],
    ["treasury TREASURY_ROLE", await smart.hasRole(roles.treasury, treasury)],
    ["authorizer AUTHORIZER_ROLE", await smart.hasRole(roles.authorizer, authorizer)],
    ["authorizer lacks WITHDRAWAL_EXECUTOR_ROLE", !await smart.hasRole(roles.withdrawalExecutor, authorizer)],
  ];
  const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Role validation failed: ${failed.join(", ")}`);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    network: "bscTestnet",
    chainId: 97,
    mockUsdt: usdtAddress,
    smartEarning: smartAddress,
    genesis,
    treasury,
    authorizer,
    deployer,
    roleChecks: checks.map(([name]) => name),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Deployment check failed"}\n`);
  process.exitCode = 1;
});
