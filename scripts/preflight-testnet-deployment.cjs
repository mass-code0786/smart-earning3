const { JsonRpcProvider, Wallet, getAddress } = require("ethers");

const EXPECTED_DEPLOYER = getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name, requiredValue = true) {
  const value = requiredValue ? required(name) : process.env[name]?.trim();
  if (!value) return undefined;
  let normalized;
  try {
    normalized = getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid checksummed address`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${name} must not be the zero address`);
  return normalized;
}

function matchingPair(serverName, publicName) {
  const server = address(serverName, false);
  const publicValue = address(publicName, false);
  if (!server && !publicValue) return;
  if (!server || !publicValue || server !== publicValue) {
    throw new Error(`${serverName} and ${publicName} must both be populated with the same address`);
  }
}

async function main() {
  const targetArg = process.argv.find((value) => value.startsWith("--target="));
  const target = targetArg?.slice("--target=".length) || "smart-earning";
  if (!["mock-usdt", "smart-earning"].includes(target)) {
    throw new Error("--target must be mock-usdt or smart-earning");
  }

  const rpcUrl = required("BSC_TESTNET_RPC_URL");
  if (required("SMART_EARNING_CHAIN_ID") !== "97") {
    throw new Error("SMART_EARNING_CHAIN_ID must be 97");
  }
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  let deployer;
  try {
    deployer = getAddress(new Wallet(privateKey).address);
  } catch {
    throw new Error("DEPLOYER_PRIVATE_KEY is invalid");
  }
  if (deployer !== EXPECTED_DEPLOYER) {
    throw new Error("DEPLOYER_PRIVATE_KEY does not derive the expected deployer address");
  }

  const treasury = address("TREASURY_WALLET");
  address("GENESIS_WALLET");
  const authorizer = address("WITHDRAWAL_AUTHORIZER_ADDRESS");
  if (authorizer === deployer) throw new Error("Withdrawal authorizer must differ from deployer/admin");
  if (treasury === authorizer) {
    throw new Error("Treasury and withdrawal authorizer must use separate addresses");
  }

  if (target === "smart-earning") address("BSC_TESTNET_USDT_ADDRESS");
  matchingPair("BSC_TESTNET_USDT_ADDRESS", "NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS");
  matchingPair("SMART_EARNING_CONTRACT_ADDRESS", "NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS");

  if ((process.env.AUTO_WITHDRAW_ENABLED || "false").toLowerCase() !== "false") {
    throw new Error("AUTO_WITHDRAW_ENABLED must remain false during deployment");
  }
  if ((process.env.WITHDRAWAL_BROADCAST_ENABLED || "false").toLowerCase() !== "false") {
    throw new Error("WITHDRAWAL_BROADCAST_ENABLED must remain false during deployment");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) throw new Error(`RPC returned unexpected chain ID ${network.chainId}`);
  const balance = await provider.getBalance(deployer);
  if (balance <= 0n) throw new Error("Expected deployer has no Testnet BNB");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    target,
    network: "bscTestnet",
    chainId: 97,
    deployer,
    funded: true,
    safetyGates: {
      autoWithdraw: false,
      withdrawalBroadcast: false,
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Testnet deployment preflight failed"}\n`);
  process.exitCode = 1;
});
