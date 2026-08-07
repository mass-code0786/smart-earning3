const { Contract, JsonRpcProvider, Wallet, getAddress } = require("ethers");

const CONTRACT_ABI = [
  "function registered(address) view returns(bool)",
  "function registrationPrice() view returns(uint256)",
  "function getPackagePrice(uint8) view returns(uint256)",
  "function totalPackageValue(address) view returns(uint256)",
  "function totalEligibleValue(address) view returns(uint256)",
  "function totalEarningCap(address) view returns(uint256)",
  "function register(address)",
  "function purchasePackage(uint8,uint256)",
];
const TOKEN_ABI = [
  "function balanceOf(address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function assertState(contract, wallet, principal, cap, stage) {
  const [packageValue, eligible, earningCap] = await Promise.all([
    contract.totalPackageValue(wallet), contract.totalEligibleValue(wallet), contract.totalEarningCap(wallet),
  ]);
  if (packageValue !== principal || eligible !== principal || earningCap !== cap) {
    throw new Error(`${stage} cap state mismatch`);
  }
}

async function main() {
  if (process.env.CAP_POLICY_VERIFY_CONFIRM !== "VERIFY_PACKAGE_ONLY_CAP_TESTNET") {
    throw new Error("CAP_POLICY_VERIFY_CONFIRM=VERIFY_PACKAGE_ONLY_CAP_TESTNET is required");
  }
  const provider = new JsonRpcProvider(required("BSC_TESTNET_RPC_URL"), 97, { staticNetwork: true });
  if (Number((await provider.getNetwork()).chainId) !== 97) throw new Error("Verification is restricted to BSC Testnet (97)");
  const contractAddress = getAddress(required("SMART_EARNING_CONTRACT_ADDRESS"));
  const tokenAddress = getAddress(required("BSC_TESTNET_USDT_ADDRESS"));
  const genesis = getAddress(required("GENESIS_WALLET"));
  let verifier;
  try { verifier = new Wallet(required("TESTNET_TEST_PRIVATE_KEY"), provider); }
  catch { throw new Error("TESTNET_TEST_PRIVATE_KEY must be a valid fresh test-wallet key"); }
  const contract = new Contract(contractAddress, CONTRACT_ABI, verifier);
  const token = new Contract(tokenAddress, TOKEN_ABI, verifier);
  if (await contract.registered(verifier.address)) throw new Error("Test wallet must be unregistered on the new contract");
  if (!await contract.registered(genesis)) throw new Error("Genesis is not registered on the new contract");
  await assertState(contract, genesis, 0n, 0n, "Genesis constructor");
  const [registrationPrice, packageOne, packageTwo] = await Promise.all([
    contract.registrationPrice(), contract.getPackagePrice(1), contract.getPackagePrice(2),
  ]);
  if (registrationPrice !== 2_000_000n || packageOne !== 8_000_000n || packageTwo !== 16_000_000n) {
    throw new Error("Unexpected testnet registration or package prices");
  }
  const requiredToken = registrationPrice + packageOne + packageTwo;
  if ((await token.balanceOf(verifier.address)) < requiredToken) throw new Error("Test wallet needs at least 26 USDT");
  if (await provider.getBalance(verifier.address) === 0n) throw new Error("Test wallet needs Testnet BNB for gas");
  await (await token.approve(contractAddress, requiredToken)).wait();
  const registration = await contract.register(genesis); await registration.wait();
  await assertState(contract, verifier.address, 0n, 0n, "Registration-only");
  const first = await contract.purchasePackage(1, packageOne); await first.wait();
  await assertState(contract, verifier.address, 8_000_000n, 40_000_000n, "First package");
  const second = await contract.purchasePackage(2, packageTwo); await second.wait();
  await assertState(contract, verifier.address, 24_000_000n, 120_000_000n, "Second package");
  process.stdout.write(`${JSON.stringify({
    status: "PASS", chainId: 97, contract: contractAddress, verifier: verifier.address,
    checks: { registrationOnlyCap: "0", firstPackageCap: "40000000", firstTwoPackagesCap: "120000000" },
    transactions: { registration: registration.hash, packageOne: first.hash, packageTwo: second.hash },
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Package-only cap verification failed"}\n`);
  process.exitCode = 1;
});
