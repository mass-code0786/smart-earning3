const deployment = require("../deployments/bsc-testnet.json");
const address = /^0x[a-fA-F0-9]{40}$/;
const privateKey = /^0x[a-fA-F0-9]{64}$/;
const catalog = {
  required: ["DATABASE_URL","SESSION_SECRET","APP_ORIGIN","PORT","BSC_TESTNET_RPC_URL","SMART_EARNING_CHAIN_ID","SMART_EARNING_CONTRACT_ADDRESS","BSC_TESTNET_USDT_ADDRESS","NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS","NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS","GENESIS_WALLET","TREASURY_WALLET","WITHDRAWAL_AUTHORIZER_ADDRESS","ADMIN_WALLETS"],
  productionOnly: ["DATABASE_SSL_MODE","DATABASE_SSL_CA","DEPLOYED_GIT_COMMIT","DEPLOYED_BUILD_ID","KEEPER_PRIVATE_KEY","AUTO_WITHDRAW_PRIVATE_KEY","WITHDRAWAL_AUTHORIZER_ADDRESS","WITHDRAWAL_AUTHORIZER_URL"],
  developmentOnly: ["LOCAL_E2E","PLACEMENT_TEST_DATABASE_URL","BOOSTER_TEST_DATABASE_URL","DIVIDEND_TEST_DATABASE_URL","OPERATIONS_TEST_DATABASE_URL","FINANCIAL_TEST_DATABASE_URL","AUTOPOOL_TEST_DATABASE_URL","X4_TEST_DATABASE_URL","TESTNET_TEST_PRIVATE_KEY","DEPLOYER_PRIVATE_KEY","BSCSCAN_API_KEY","SMART_EARNING_DEPLOY_CONFIRM","SMART_EARNING_ROLE_CONFIRM","CAP_POLICY_VERIFY_CONFIRM"],
  optional: ["SMART_EARNING_DEPLOYMENT_BLOCK","BSC_TESTNET_RPC_FALLBACK_URLS","KEEPER_SECRET","BLOCKCHAIN_INDEXER_START_BLOCK","X3_RECOVERY_ENABLED","MAGIC_DISTRIBUTION_TIMEZONE","MAGIC_DISTRIBUTION_HOUR","MAGIC_DISTRIBUTION_MINUTE","MAGIC_DISTRIBUTION_WORKER_INTERVAL_SECONDS","DAILY_DIVIDEND_ENABLED","DAILY_DIVIDEND_TIMEZONE","DAILY_DIVIDEND_SETTLEMENT_HOUR","DAILY_DIVIDEND_SETTLEMENT_MINUTE","DAILY_DIVIDEND_WORKER_INTERVAL_SECONDS","AUTO_WITHDRAW_ENABLED","WITHDRAWAL_BROADCAST_ENABLED"],
  dangerousDefaults: ["DATABASE_SSL_MODE=disable","APP_ORIGIN=http://localhost:3000","SESSION_SECRET=replace-with-*","AUTO_WITHDRAW_ENABLED=true without executor/authorizer","WITHDRAWAL_BROADCAST_ENABLED=true without executor/authorizer"],
};

function validateProductionEnvironment(environment) {
  const errors = [], warnings = [];
  for (const key of catalog.required) if (!String(environment[key] || "").trim()) errors.push(`${key} is required`);
  if (environment.NODE_ENV !== "production") errors.push("NODE_ENV must equal production");
  if (environment.PORT !== "3015") errors.push("PORT must equal the Nginx upstream port 3015");
  try { if (!["postgres:","postgresql:"].includes(new URL(environment.DATABASE_URL).protocol)) errors.push("DATABASE_URL must use PostgreSQL"); }
  catch { errors.push("DATABASE_URL must be a valid PostgreSQL URL"); }
  try { if (new URL(environment.APP_ORIGIN).protocol !== "https:") errors.push("APP_ORIGIN must use HTTPS"); }
  catch { errors.push("APP_ORIGIN must be a valid HTTPS URL"); }
  if (!environment.SESSION_SECRET || environment.SESSION_SECRET.length < 48 || /replace|example|changeme/i.test(environment.SESSION_SECRET)) errors.push("SESSION_SECRET must be an unguessable production secret of at least 48 characters");
  if (environment.SMART_EARNING_CHAIN_ID !== String(deployment.chainId)) errors.push("SMART_EARNING_CHAIN_ID must match authoritative deployment metadata");
  const block = String(environment.SMART_EARNING_DEPLOYMENT_BLOCK || "").trim();
  if (block && block !== String(deployment.blockNumber)) errors.push("SMART_EARNING_DEPLOYMENT_BLOCK must match authoritative deployment metadata");
  const expected = { SMART_EARNING_CONTRACT_ADDRESS: deployment.address, NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS: deployment.address, BSC_TESTNET_USDT_ADDRESS: deployment.usdt, NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS: deployment.usdt, GENESIS_WALLET: deployment.genesis, TREASURY_WALLET: deployment.treasury, WITHDRAWAL_AUTHORIZER_ADDRESS: deployment.authorizer };
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] && !address.test(environment[key])) errors.push(`${key} must be an EVM address`);
    else if (environment[key] && environment[key].toLowerCase() !== value.toLowerCase()) errors.push(`${key} must match authoritative deployment metadata`);
  }
  if (environment.DATABASE_SSL_MODE === "disable") warnings.push("DATABASE_SSL_MODE=disable is safe only for a same-host/private-socket PostgreSQL connection");
  if (environment.AUTO_WITHDRAW_ENABLED === "true" || environment.WITHDRAWAL_BROADCAST_ENABLED === "true") {
    if (!privateKey.test(environment.AUTO_WITHDRAW_PRIVATE_KEY || "")) errors.push("AUTO_WITHDRAW_PRIVATE_KEY is required when withdrawals are enabled");
    if (!address.test(environment.WITHDRAWAL_AUTHORIZER_ADDRESS || "")) errors.push("WITHDRAWAL_AUTHORIZER_ADDRESS is required when withdrawals are enabled");
    try { if (new URL(environment.WITHDRAWAL_AUTHORIZER_URL).protocol !== "https:") throw new Error(); }
    catch { errors.push("WITHDRAWAL_AUTHORIZER_URL must be a valid HTTPS URL when withdrawals are enabled"); }
  }
  for (const key of catalog.developmentOnly) if (environment[key]) errors.push(`${key} must not be set in production`);
  return { valid: errors.length === 0, errors, warnings, catalog };
}
function assertProductionEnvironment(environment) { const result = validateProductionEnvironment(environment); if (!result.valid) throw new Error(`Production environment invalid: ${result.errors.join("; ")}`); return result; }
if (require.main === module) { try { const result = assertProductionEnvironment(process.env); process.stdout.write(JSON.stringify({ valid: true, warnings: result.warnings, catalog: result.catalog }, null, 2) + "\n"); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; } }
module.exports = { catalog, validateProductionEnvironment, assertProductionEnvironment };
