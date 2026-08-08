const { Client } = require("pg");

const TEST_URL_KEYS = ["SMART_EARNING_TEST_DATABASE_URL", "TEST_DATABASE_URL"];
const TEST_DATABASE_PATTERN = /(?:^|[_-])test(?:$|[_-])/i;
const FORBIDDEN_DATABASES = new Set(["postgres", "smartearning", "smart_earning", "production", "template0", "template1"]);

function databaseName(url) {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
}

function parseDatabaseUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  if (!url.username) throw new Error(`${label} must include a database user`);
  if (typeof url.password !== "string" || url.password.length === 0) {
    throw new Error(`${label} must include a non-empty string password`);
  }
  if (!databaseName(url)) throw new Error(`${label} must include a database name`);
  return url;
}

function sameDatabase(left, right) {
  return left.hostname.toLowerCase() === right.hostname.toLowerCase()
    && (left.port || "5432") === (right.port || "5432")
    && databaseName(left).toLowerCase() === databaseName(right).toLowerCase();
}

function assertSafeTestDatabaseUrl(value, productionValue = process.env.DATABASE_URL) {
  const url = parseDatabaseUrl(value, "test database URL");
  const name = databaseName(url);
  if (FORBIDDEN_DATABASES.has(name.toLowerCase()) || !TEST_DATABASE_PATTERN.test(name)) {
    throw new Error(`Test database name must contain a standalone 'test' marker; received ${JSON.stringify(name)}`);
  }
  if (productionValue?.trim()) {
    const production = parseDatabaseUrl(productionValue, "production DATABASE_URL");
    if (sameDatabase(url, production)) {
      throw new Error("Test database URL must not target the production DATABASE_URL database");
    }
  }
  return url;
}

function explicitTestDatabaseUrl(environment = process.env) {
  for (const key of TEST_URL_KEYS) {
    if (environment[key]?.trim()) return { key, value: environment[key].trim() };
  }
  return undefined;
}

function clientConfig(url, database = databaseName(url)) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: false,
    connectionTimeoutMillis: 5_000,
  };
}

async function ensureDatabaseExists(url) {
  const target = databaseName(url);
  const admin = new Client(clientConfig(url, "postgres"));
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [target]);
    if (!exists.rowCount) {
      const identifier = `"${target.replaceAll('"', '""')}"`;
      await admin.query(`CREATE DATABASE ${identifier}`);
    }
  } finally {
    await admin.end();
  }
}

function integrationEnvironment(url, environment = process.env) {
  const value = url.toString();
  return {
    ...environment,
    NODE_ENV: "test",
    DATABASE_URL: value,
    DATABASE_SSL_MODE: "disable",
    PLACEMENT_TEST_DATABASE_URL: value,
    BOOSTER_TEST_DATABASE_URL: value,
    DIVIDEND_TEST_DATABASE_URL: value,
    OPERATIONS_TEST_DATABASE_URL: value,
    FINANCIAL_TEST_DATABASE_URL: value,
    AUTOPOOL_TEST_DATABASE_URL: value,
    X4_TEST_DATABASE_URL: value,
    X3_DIRECT_TEST_DATABASE_URL: value,
  };
}

module.exports = {
  TEST_URL_KEYS,
  assertSafeTestDatabaseUrl,
  clientConfig,
  databaseName,
  ensureDatabaseExists,
  explicitTestDatabaseUrl,
  integrationEnvironment,
};
