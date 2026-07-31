const { readFileSync } = require("node:fs");
const dotenv = require("dotenv");

const runtimeExcluded = [
  "LOCAL_E2E",
  "PLACEMENT_TEST_DATABASE_URL",
  "BOOSTER_TEST_DATABASE_URL",
  "DIVIDEND_TEST_DATABASE_URL",
  "OPERATIONS_TEST_DATABASE_URL",
  "FINANCIAL_TEST_DATABASE_URL",
  "AUTOPOOL_TEST_DATABASE_URL",
  "X4_TEST_DATABASE_URL",
  "TESTNET_TEST_PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "BSCSCAN_API_KEY",
];

function loadProductionPm2Environment(
  envFile,
  existingEnvironment = process.env,
) {
  const parsed = dotenv.parse(readFileSync(envFile));
  // The production file is authoritative. PM2 evaluates ecosystem files with
  // its previously saved environment in process.env; allowing that stale state
  // to win makes corrected and intentionally cleared values ineffective.
  const resolved = { ...existingEnvironment, ...parsed };
  for (const key of runtimeExcluded) delete resolved[key];

  if (!resolved.DATABASE_URL) {
    throw new Error(
      `PM2 startup refused: DATABASE_URL is missing from the process environment and ${envFile}`,
    );
  }
  if (resolved.NODE_ENV && resolved.NODE_ENV !== "production") {
    throw new Error(
      `PM2 startup refused: NODE_ENV must be production, received ${resolved.NODE_ENV}`,
    );
  }

  return {
    ...resolved,
    NODE_ENV: "production",
    DATABASE_URL: resolved.DATABASE_URL,
  };
}

module.exports = { loadProductionPm2Environment };
