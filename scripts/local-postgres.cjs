const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Client } = require("pg");

const execFileAsync = promisify(execFile);
const CONTAINER_NAME = "smart-earning-postgres";
const IMAGE = "postgres:16";

async function docker(args) {
  try {
    const result = await execFileAsync("docker", args, { windowsHide: true });
    return result.stdout.trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Docker ${args.join(" ")} failed: ${detail}`);
  }
}

async function inspectContainer(runDocker = docker) {
  try {
    const output = await runDocker(["inspect", CONTAINER_NAME]);
    return JSON.parse(output)[0];
  } catch (error) {
    if (/No such (object|container)/i.test(error.message)) return undefined;
    throw error;
  }
}

async function postgresConnects(url) {
  const admin = new URL(url);
  const client = new Client({
    host: admin.hostname,
    port: Number(admin.port || 5432),
    user: decodeURIComponent(admin.username),
    password: decodeURIComponent(admin.password),
    database: "postgres",
    ssl: false,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function assertLocalDatabaseUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Local PostgreSQL bootstrap refuses a non-local DATABASE_URL");
  }
  if (!url.port) throw new Error("Local PostgreSQL DATABASE_URL must specify a host port");
  return url;
}

async function ensureLocalPostgres(value, options = {}) {
  const url = assertLocalDatabaseUrl(value);
  const runDocker = options.runDocker || docker;
  const connects = options.connects || postgresConnects;
  const pause = options.pause || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const attempts = options.attempts || 60;
  let inspected = await inspectContainer(runDocker);
  let action = "already running";

  if (!inspected) {
    action = "created";
    await runDocker([
      "run", "-d", "--name", CONTAINER_NAME,
      "-e", `POSTGRES_USER=${decodeURIComponent(url.username)}`,
      "-e", `POSTGRES_PASSWORD=${decodeURIComponent(url.password)}`,
      "-e", `POSTGRES_DB=${url.pathname.slice(1) || "smartearning"}`,
      "-p", `${url.port}:5432`,
      "-v", "smart_earning_postgres_data:/var/lib/postgresql/data",
      "--health-cmd", "pg_isready -U postgres -d postgres",
      "--health-interval", "1s", "--health-timeout", "3s", "--health-retries", "30",
      IMAGE,
    ]);
  } else {
    const binding = inspected.HostConfig?.PortBindings?.["5432/tcp"]?.[0]?.HostPort;
    if (binding && binding !== url.port) {
      throw new Error(
        `${CONTAINER_NAME} maps PostgreSQL to port ${binding}, but DATABASE_URL uses ${url.port}`,
      );
    }
    if (!inspected.State?.Running) {
      action = "started";
      await runDocker(["start", CONTAINER_NAME]);
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    inspected = await inspectContainer(runDocker);
    const health = inspected?.State?.Health?.Status;
    const dockerReady = inspected?.State?.Running && (!health || health === "healthy");
    if (dockerReady && await connects(url)) return { action, health: health || "connectable" };
    if (health === "unhealthy") {
      throw new Error(`${CONTAINER_NAME} Docker health check reported unhealthy`);
    }
    if (attempt < attempts) await pause(1_000);
  }
  throw new Error(`${CONTAINER_NAME} did not become healthy and connectable`);
}

function displayDatabaseUrl(value) {
  const url = new URL(value);
  if (url.password) url.password = "***";
  return url.toString();
}

module.exports = {
  CONTAINER_NAME,
  displayDatabaseUrl,
  ensureLocalPostgres,
  inspectContainer,
};
