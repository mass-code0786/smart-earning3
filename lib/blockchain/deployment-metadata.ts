import productionDeployment from "@/deployments/bsc-testnet.json";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;

export type SmartEarningDeployment = {
  chainId: number;
  address: string;
  txHash: string;
  blockNumber: number;
  genesis: string;
};

type DeploymentMetadataInput = {
  chainId?: unknown;
  address?: unknown;
  txHash?: unknown;
  blockNumber?: unknown;
  genesis?: unknown;
};

function validateDeployment(deployment: DeploymentMetadataInput, source: string): SmartEarningDeployment {
  if (!Number.isSafeInteger(deployment.chainId) || Number(deployment.chainId) < 1)
    throw new Error(`${source}: chainId is missing or invalid`);
  if (typeof deployment.address !== "string" || !addressPattern.test(deployment.address))
    throw new Error(`${source}: contract address is missing or invalid`);
  if (typeof deployment.txHash !== "string" || !hashPattern.test(deployment.txHash))
    throw new Error(`${source}: deployment transaction hash is missing or invalid`);
  if (!Number.isSafeInteger(deployment.blockNumber) || Number(deployment.blockNumber) < 1)
    throw new Error(`${source}: deployment block number is missing or invalid`);
  if (typeof deployment.genesis !== "string" || !addressPattern.test(deployment.genesis))
    throw new Error(`${source}: genesis wallet is missing or invalid`);
  return {
    chainId: Number(deployment.chainId),
    address: deployment.address.toLowerCase(),
    txHash: deployment.txHash.toLowerCase(),
    blockNumber: Number(deployment.blockNumber),
    genesis: deployment.genesis.toLowerCase(),
  };
}

export function smartEarningDeployment(
  environment: Partial<Record<string, string | undefined>> = process.env,
): SmartEarningDeployment {
  const localMetadata = environment.LOCAL_E2E_DEPLOYMENT_METADATA?.trim();
  if (localMetadata && environment.LOCAL_E2E !== "true") {
    throw new Error("LOCAL_E2E_DEPLOYMENT_METADATA is only allowed when LOCAL_E2E=true");
  }
  let selected = validateDeployment(productionDeployment, "deployments/bsc-testnet.json");
  if (environment.LOCAL_E2E === "true") {
    if (!localMetadata) throw new Error("LOCAL_E2E_DEPLOYMENT_METADATA is required when LOCAL_E2E=true");
    let parsed: DeploymentMetadataInput;
    try {
      parsed = JSON.parse(localMetadata) as DeploymentMetadataInput;
    } catch {
      throw new Error("LOCAL_E2E_DEPLOYMENT_METADATA is not valid JSON");
    }
    selected = validateDeployment(parsed, "LOCAL_E2E_DEPLOYMENT_METADATA");
  }

  const conflicts: string[] = [];
  const envChain = environment.SMART_EARNING_CHAIN_ID?.trim();
  const envAddress = environment.SMART_EARNING_CONTRACT_ADDRESS?.trim();
  const envBlock = environment.SMART_EARNING_DEPLOYMENT_BLOCK?.trim();
  if (envChain && Number(envChain) !== selected.chainId) conflicts.push("SMART_EARNING_CHAIN_ID");
  if (envAddress && envAddress.toLowerCase() !== selected.address) {
    conflicts.push("SMART_EARNING_CONTRACT_ADDRESS");
  }
  if (envBlock) {
    const parsedBlock = Number(envBlock);
    if (!Number.isSafeInteger(parsedBlock) || parsedBlock < 1) {
      throw new Error(
        "Invalid indexer configuration: SMART_EARNING_DEPLOYMENT_BLOCK " +
        "must be a positive integer when set; the variable may be omitted because " +
        "deployments/bsc-testnet.json is authoritative",
      );
    }
    if (parsedBlock !== selected.blockNumber) conflicts.push("SMART_EARNING_DEPLOYMENT_BLOCK");
  }
  if (conflicts.length) {
    throw new Error(
      `Deployment metadata conflicts with environment configuration: ${conflicts.join(", ")}`,
    );
  }
  return selected;
}
