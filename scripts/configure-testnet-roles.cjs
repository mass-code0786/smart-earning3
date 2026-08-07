const hre = require("hardhat");
const EXPECTED_DEPLOYER = hre.ethers.getAddress("0xf3a86386FE213901C8e02067c83B8cEb1f3aF508");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function signerAddress(name) {
  try {
    return hre.ethers.getAddress(new hre.ethers.Wallet(required(name)).address);
  } catch {
    throw new Error(`${name} must be a valid private key`);
  }
}

async function grantIfMissing(contract, role, account) {
  if (await contract.hasRole(role, account)) return null;
  const transaction = await contract.grantRole(role, account);
  await transaction.wait();
  return transaction.hash;
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (hre.network.name !== "bscTestnet" || Number(network.chainId) !== 97) {
    throw new Error("Role configuration is restricted to BSC Testnet (97)");
  }
  if (process.env.SMART_EARNING_ROLE_CONFIRM !== "CONFIGURE_PACKAGE_ONLY_CAP_TESTNET") {
    throw new Error("SMART_EARNING_ROLE_CONFIRM=CONFIGURE_PACKAGE_ONLY_CAP_TESTNET is required");
  }
  const address = hre.ethers.getAddress(required("SMART_EARNING_CONTRACT_ADDRESS"));
  const keeper = signerAddress("KEEPER_PRIVATE_KEY");
  const executor = signerAddress("AUTO_WITHDRAW_PRIVATE_KEY");
  const authorizer = hre.ethers.getAddress(required("WITHDRAWAL_AUTHORIZER_ADDRESS"));
  if (executor === authorizer) throw new Error("Withdrawal executor and authorizer must be separate");
  const [admin] = await hre.ethers.getSigners();
  if (hre.ethers.getAddress(admin.address) !== EXPECTED_DEPLOYER) throw new Error("Unexpected deployer/admin signer");
  const contract = await hre.ethers.getContractAt("SmartEarning", address, admin);
  const defaultAdminRole = await contract.DEFAULT_ADMIN_ROLE();
  if (!await contract.hasRole(defaultAdminRole, admin.address)) throw new Error("Deployer lacks DEFAULT_ADMIN_ROLE");
  const keeperTx = await grantIfMissing(contract, await contract.KEEPER_ROLE(), keeper);
  const executorTx = await grantIfMissing(contract, await contract.WITHDRAWAL_EXECUTOR_ROLE(), executor);
  process.stdout.write(`${JSON.stringify({
    status: "PASS", chainId: 97, contract: address, admin: admin.address,
    keeper, withdrawalExecutor: executor,
    grants: { keeper: keeperTx || "ALREADY_CONFIGURED", withdrawalExecutor: executorTx || "ALREADY_CONFIGURED" },
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Role configuration failed"}\n`);
  process.exitCode = 1;
});
