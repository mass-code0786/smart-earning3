const { readFileSync } = require("node:fs");
const dotenv = require("dotenv");

function loadProductionPm2Environment(
  envFile,
  existingEnvironment = process.env,
) {
  const parsed = dotenv.parse(readFileSync(envFile));
  const resolved = { ...parsed, ...existingEnvironment };

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
