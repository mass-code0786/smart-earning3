const { spawn } = require("node:child_process");
const { Client } = require("pg");
const { HDNodeWallet } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");
const { displayDatabaseUrl, ensureLocalPostgres } = require("./local-postgres.cjs");

const root = path.resolve(__dirname, "..");
const children = new Set();
const verifyOnly = process.argv.includes("--verify-only");
const stageTimeoutMs = 3 * 60_000;
const overallTimeoutMs = 15 * 60_000;
const logDirectory = path.join(root, "evidence", "local-e2e");
fs.mkdirSync(logDirectory, { recursive: true });
const logStream = fs.createWriteStream(path.join(logDirectory, "verify.log"), { flags: "w" });
const mnemonic = "test test test test test test test test test test test junk";
const account = i => HDNodeWallet.fromPhrase(mnemonic, "", `m/44'/60'/0'/0/${i}`);
const keys = { keeper: account(3).privateKey, executor: account(7).privateKey };
let databaseUrl;
let cleaning = false;

const stamp = () => new Date().toISOString();
const stage = message => {
  const line = `[local:e2e ${stamp()}] ${message}`;
  console.log(line);
  logStream.write(`${line}\n`);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function terminateTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        cwd: root, windowsHide: true, stdio: "ignore",
      });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 10_000);
      killer.once("exit", () => { clearTimeout(timer); resolve(); });
      killer.once("error", () => { clearTimeout(timer); resolve(); });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
        resolve();
      }, 5_000);
    }
  });
}

function run(label, command, args, env, timeoutMs) {
  stage(`START ${label}: ${command} ${args.join(" ")} (timeout ${timeoutMs}ms)`);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
      windowsHide: true, detached: process.platform !== "win32",
    });
    children.add(child);
    child.stdout.on("data", chunk => { process.stdout.write(chunk); logStream.write(chunk); });
    child.stderr.on("data", chunk => { process.stderr.write(chunk); logStream.write(chunk); });
    let settled = false;
    const finish = async error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      if (error) {
        await terminateTree(child);
        stage(`FAIL ${label} after ${Date.now() - started}ms: ${error.message}`);
        reject(error);
      } else {
        stage(`PASS ${label} after ${Date.now() - started}ms`);
        resolve();
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`${label} timed out: ${command} ${args.join(" ")}`)),
      timeoutMs,
    );
    child.once("error", error => finish(error));
    child.once("exit", (code, signal) => finish(
      code === 0 ? undefined : new Error(`${command} ${args.join(" ")} exited ${code ?? signal}`),
    ));
  });
}

function background(label, command, args, env) {
  stage(`START ${label}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    windowsHide: true, detached: process.platform !== "win32",
  });
  child.e2eLabel = label;
  children.add(child);
  child.stdout.on("data", chunk => { process.stdout.write(chunk); logStream.write(chunk); });
  child.stderr.on("data", chunk => { process.stderr.write(chunk); logStream.write(chunk); });
  child.once("exit", (code, signal) => {
    children.delete(child);
    stage(`EXIT ${label}: ${code ?? signal}`);
  });
  return child;
}

async function waitFor(label, attempts, intervalMs, probe) {
  stage(`WAIT ${label} (timeout ${attempts * intervalMs}ms)`);
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) { stage(`READY ${label}`); return; } } catch {}
    await delay(intervalMs);
  }
  throw new Error(`${label} readiness timed out after ${attempts * intervalMs}ms`);
}

async function rpcReady() {
  const response = await fetch("http://127.0.0.1:8545", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(2_000),
  });
  return (await response.json()).result === "0x7a69";
}

async function webReady() {
  const response = await fetch("http://127.0.0.1:3020/login", {
    signal: AbortSignal.timeout(3_000),
  });
  return response.ok;
}

function configuredDatabaseUrl() {
  const raw = process.env.DATABASE_URL || fs.readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/).find(line => line.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g, "");
  if (!raw) throw new Error("A local PostgreSQL DATABASE_URL is required");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("local:e2e refuses a non-local PostgreSQL server");
  return url;
}

async function adminClient(url) {
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const client = new Client({
    connectionString: adminUrl.toString(), ssl: false,
    connectionTimeoutMillis: 10_000, query_timeout: 15_000,
  });
  await client.connect();
  return client;
}

async function dropDatabase(url, name) {
  if (!/^smartearning_local_e2e_\d+$/.test(name)) return;
  const client = await adminClient(url);
  try {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    stage(`CLEANED disposable database ${name}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function cleanStaleDatabases(url) {
  stage("START cleanup stale disposable E2E databases");
  const client = await adminClient(url);
  let names;
  try {
    names = (await client.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'smartearning_local_e2e_%'",
    )).rows.map(row => row.datname);
  } finally {
    await client.end().catch(() => undefined);
  }
  for (const name of names) await dropDatabase(url, name);
  stage(`PASS cleanup stale disposable E2E databases (${names.length} found)`);
}

async function createDatabase(url) {
  const name = `smartearning_local_e2e_${Date.now()}`;
  const client = await adminClient(url);
  try { await client.query(`CREATE DATABASE "${name}"`); }
  finally { await client.end().catch(() => undefined); }
  const result = new URL(url);
  result.pathname = `/${name}`;
  stage(`CREATED disposable database ${name}`);
  return result.toString();
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  stage("START cleanup");
  await Promise.allSettled([...children].map(terminateTree));
  children.clear();
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    await dropDatabase(url, url.pathname.slice(1)).catch(error =>
      stage(`CLEANUP WARNING database: ${error.message}`));
  }
  stage("FINISH cleanup");
}

async function main() {
  const configured = configuredDatabaseUrl();
  stage(`effective DATABASE_URL=${displayDatabaseUrl(configured)}`);
  stage("START PostgreSQL dependency bootstrap");
  const postgres = await ensureLocalPostgres(configured);
  stage(`READY PostgreSQL dependency (${postgres.action}, ${postgres.health})`);
  await cleanStaleDatabases(configured);
  databaseUrl = await createDatabase(configured);
  const base = {
    ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable", LOCAL_E2E: "true",
    SMART_EARNING_CHAIN_ID: "31337", BSC_TESTNET_RPC_URL: "http://127.0.0.1:8545",
    CONFIRMATIONS_REQUIRED: "1", SESSION_SECRET: "local-e2e-only-session-secret-000000000000",
    APP_ORIGIN: "http://127.0.0.1:3020", AUTO_WITHDRAW_ENABLED: "true",
    WITHDRAWAL_BROADCAST_ENABLED: "false", NEXT_PUBLIC_USDT_DECIMALS: "6",
    NEXT_PUBLIC_SMART_EARNING_CHAIN_ID: "31337", NEXT_PUBLIC_NETWORK_NAME: "Hardhat Local",
    GENESIS_WALLET: account(1).address, KEEPER_PRIVATE_KEY: keys.keeper,
    AUTO_WITHDRAW_PRIVATE_KEY: keys.executor, WITHDRAWAL_AUTHORIZER_ADDRESS: account(8).address,
    WITHDRAWAL_AUTHORIZER_URL: "http://127.0.0.1:3999/sign-withdrawal", X3_RECOVERY_ENABLED: "true",
  };

  await run("contract compile", "npx.cmd", ["hardhat", "compile"], base, stageTimeoutMs);
  background("Hardhat RPC", "npx.cmd", ["hardhat", "node", "--hostname", "127.0.0.1"], base);
  await waitFor("Hardhat RPC", 60, 500, rpcReady);
  await run("database migrations", "npm.cmd", ["run", "migrate"], base, stageTimeoutMs);
  await run("genesis seed", "npm.cmd", ["run", "seed:genesis"], base, stageTimeoutMs);
  await run("application scenario", "npx.cmd", ["tsx", "scripts/local-e2e-scenario.ts"], base, stageTimeoutMs);

  const runtime = Object.fromEntries(fs.readFileSync(path.join(root, "evidence/local-e2e/runtime.env"), "utf8")
    .trim().split(/\r?\n/).map(line => line.split(/=(.*)/s).slice(0, 2)));
  const env = { ...base, ...runtime };
  await run("X3 recovery pass 1", "npm.cmd", ["run", "x3:recovery"], env, stageTimeoutMs);
  await run("X3 recovery pass 2", "npm.cmd", ["run", "x3:recovery"], env, stageTimeoutMs);
  await run("X3 recovery audit", "npm.cmd", ["run", "x3:recovery-audit"], env, stageTimeoutMs);
  await run("Next.js build", "npm.cmd", ["run", "build"], env, stageTimeoutMs);
  background("Next.js server", "npm.cmd", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", "3020"], env);
  await waitFor("Next.js server", 120, 500, webReady);
  await run("browser audit", "npx.cmd", ["tsx", "scripts/local-e2e-browser.ts"], env, stageTimeoutMs);

  if (verifyOnly) return;
  background("indexer", "npm.cmd", ["run", "indexer"], env);
  stage("Local Smart Earning E2E is running at http://127.0.0.1:3020 (Ctrl+C to stop)");
  await new Promise(() => {});
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stage(`RECEIVED ${signal}`);
    cleanup().finally(() => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
  });
}

let overallTimer;
Promise.race([
  main(),
  new Promise((_, reject) => {
    overallTimer = setTimeout(
      () => reject(new Error(`overall E2E verification timed out after ${overallTimeoutMs}ms`)),
      overallTimeoutMs,
    );
  }),
])
  .then(async () => { if (verifyOnly) await cleanup(); })
  .catch(async error => {
    stage(`FAILED at current stage: ${error.stack || error}`);
    process.exitCode = 1;
    await cleanup();
  })
  .finally(() => {
    clearTimeout(overallTimer);
    logStream.end();
  });
