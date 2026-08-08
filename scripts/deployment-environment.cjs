const deployment = require("../deployments/bsc-testnet.json");

function authoritativeDeploymentEnvironment(environment) {
  const expected = {
    SMART_EARNING_CHAIN_ID: String(deployment.chainId),
    SMART_EARNING_CONTRACT_ADDRESS: deployment.address,
    NEXT_PUBLIC_SMART_EARNING_CHAIN_ID: String(deployment.chainId),
    NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS: deployment.address,
    BSC_TESTNET_USDT_ADDRESS: deployment.usdt,
    NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS: deployment.usdt,
    GENESIS_WALLET: deployment.genesis,
    TREASURY_WALLET: deployment.treasury,
    WITHDRAWAL_AUTHORIZER_ADDRESS: deployment.authorizer,
    NEXT_PUBLIC_NETWORK_NAME: deployment.networkName,
    NEXT_PUBLIC_NATIVE_CURRENCY_NAME: deployment.nativeCurrencyName,
    NEXT_PUBLIC_NATIVE_CURRENCY_SYMBOL: deployment.nativeCurrencySymbol,
    NEXT_PUBLIC_BLOCK_EXPLORER_URL: deployment.blockExplorerUrl,
    NEXT_PUBLIC_SMART_EARNING_RPC_URL: environment.SMART_EARNING_RPC_URL || environment.BSC_TESTNET_RPC_URL,
  };
  const conflicts = Object.entries(expected).filter(([key, value]) => {
    const configured = String(environment[key] || "").trim();
    return configured && configured.toLowerCase() !== String(value).toLowerCase();
  }).map(([key]) => key);
  const configuredBlock = String(environment.SMART_EARNING_DEPLOYMENT_BLOCK || "").trim();
  if (configuredBlock && configuredBlock !== String(deployment.blockNumber)) {
    conflicts.push("SMART_EARNING_DEPLOYMENT_BLOCK");
  }
  if (conflicts.length) {
    throw new Error(`Environment conflicts with deployments/bsc-testnet.json: ${conflicts.join(", ")}`);
  }
  return { ...environment, ...expected };
}

module.exports = { authoritativeDeploymentEnvironment };
