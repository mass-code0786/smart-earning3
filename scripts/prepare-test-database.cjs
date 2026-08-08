const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { displayDatabaseUrl, ensureLocalPostgres } = require("./local-postgres.cjs");
const {
  assertSafeTestDatabaseUrl,
  ensureDatabaseExists,
  explicitTestDatabaseUrl,
  integrationEnvironment,
} = require("./test-database.cjs");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const dockerDefault = "postgresql://postgres:postgres@127.0.0.1:5433/smartearning_test";

async function dockerAvailable() {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeout: 5_000, windowsHide: true,
    });
    return true;
  } catch { return false; }
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root, env: environment, stdio: "inherit", shell: false,
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function selectTestDatabase() {
  const explicit = explicitTestDatabaseUrl();
  if (explicit) return { url: assertSafeTestDatabaseUrl(explicit.value), source: explicit.key };
  if (!await dockerAvailable()) {
    throw new Error(
      "No safe test database configured. Set SMART_EARNING_TEST_DATABASE_URL to a dedicated database whose name contains 'test'. Docker is optional and was not available.",
    );
  }
  const url = assertSafeTestDatabaseUrl(dockerDefault);
  await ensureLocalPostgres(url.toString());
  return { url, source: "local Docker" };
}

async function main() {
  const selected = await selectTestDatabase();
  await ensureDatabaseExists(selected.url);
  const environment = integrationEnvironment(selected.url);
  console.log(`[postgres:test] source=${selected.source} target=${displayDatabaseUrl(selected.url.toString())}`);
  await run(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/migrate.ts"], {
    ...environment, PRODUCTION_DATABASE_SOURCE: "validated-deploy",
  });
  if (!process.argv.includes("--prepare-only")) {
    await run(process.execPath, [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run"], environment);
  }
}

main().catch(error => {
  console.error(`[postgres:test] ${error.message}`);
  process.exitCode = 1;
});
