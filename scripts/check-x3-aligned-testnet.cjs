const { Contract, Interface, JsonRpcProvider, getAddress, keccak256 } = require("ethers");
const { readFile } = require("node:fs/promises");
const { basename, resolve } = require("node:path");

const ABI = [
  "function usdt() view returns(address)",
  "function oneDollar() view returns(uint256)",
  "function registrationPrice() view returns(uint256)",
  "function levelPayment() view returns(uint256)",
  "function treasuryWallet() view returns(address)",
  "function registered(address) view returns(bool)",
  "function x3DirectSlotCount(uint8,address) view returns(uint8)",
  "function x3DirectCycleNumber(uint8,address) view returns(uint256)",
  "event X3DirectSlotFilled(address indexed buyer,address indexed owner,uint8 indexed packageId,uint256 cycleNumber,uint8 slotNumber,address recipient,uint8 disposition,uint256 packageAmount,uint256 grossAmount)",
];
const TOKEN_ABI = ["function decimals() view returns(uint8)"];

function normalizeImmutables(bytecode, immutableReferences) {
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) bytes.fill(0, start, start + length);
  }
  return `0x${bytes.toString("hex")}`;
}

async function artifactRuntime() {
  const artifactDir = resolve("artifacts", "contracts", "SmartEarning.sol");
  const artifact = JSON.parse(await readFile(resolve(artifactDir, "SmartEarning.json"), "utf8"));
  const debug = JSON.parse(await readFile(resolve(artifactDir, "SmartEarning.dbg.json"), "utf8"));
  const buildInfo = JSON.parse(await readFile(resolve("artifacts", "build-info", basename(debug.buildInfo)), "utf8"));
  const compiled = buildInfo.output.contracts["contracts/SmartEarning.sol"].SmartEarning.evm.deployedBytecode;
  return { bytecode: artifact.deployedBytecode, immutableReferences: compiled.immutableReferences };
}

async function main() {
  const rpc = process.env.BSC_TESTNET_RPC_URL;
  if (!rpc) throw new Error("BSC_TESTNET_RPC_URL is required");
  const provider = new JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 97) throw new Error("RPC is not BSC Testnet");

  const deployment = JSON.parse(await readFile(resolve("deployments", "bsc-testnet-x3-aligned.json"), "utf8"));
  const address = getAddress(deployment.address);
  const actualCode = await provider.getCode(address);
  if (actualCode === "0x") throw new Error("Aligned contract bytecode is missing");

  const artifact = await artifactRuntime();
  const normalizedActualHash = keccak256(normalizeImmutables(actualCode, artifact.immutableReferences));
  const normalizedArtifactHash = keccak256(normalizeImmutables(artifact.bytecode, artifact.immutableReferences));
  const expectedHash = deployment.normalizedRuntimeBytecodeHash || deployment.deployedBytecodeHash;
  if (normalizedActualHash !== normalizedArtifactHash || normalizedActualHash !== expectedHash) {
    throw new Error("Aligned normalized runtime bytecode hash mismatch");
  }

  const contract = new Contract(address, ABI, provider);
  const token = new Contract(deployment.usdt, TOKEN_ABI, provider);
  const oneDollar = 10n ** BigInt(await token.decimals());
  if (
    getAddress(await contract.usdt()) !== getAddress(deployment.usdt) ||
    getAddress(await contract.treasuryWallet()) !== getAddress(deployment.treasury) ||
    !(await contract.registered(deployment.genesis)) ||
    (await contract.oneDollar()) !== oneDollar ||
    (await contract.registrationPrice()) !== 2n * oneDollar ||
    (await contract.levelPayment()) !== oneDollar / 20n
  ) throw new Error("Constructor or immutable state mismatch");

  new Interface(ABI).getEvent("X3DirectSlotFilled");
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    chainId: 97,
    address,
    alignment: deployment.alignment,
    rolloutMode: deployment.rolloutMode,
    actualRuntimeBytecodeHash: keccak256(actualCode),
    normalizedRuntimeBytecodeHash: normalizedActualHash,
  }, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Aligned readiness failed"}\n`);
  process.exitCode = 1;
});

module.exports = { normalizeImmutables };
