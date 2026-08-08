import { Pool, PoolClient, PoolConfig, QueryResultRow } from "pg";
import { trimmedEnvValue } from "./env";

export type DatabaseSslMode = "disable" | "require" | "verify-full";
export type DatabaseErrorCode =
  | "CONNECTION_REFUSED"
  | "SSL_UNSUPPORTED"
  | "AUTHENTICATION_FAILED"
  | "DATABASE_MISSING"
  | "MIGRATION_MISSING"
  | "PERMISSION_DENIED"
  | "SCHEMA_INCOMPATIBLE"
  | "CONSTRAINT_VIOLATION"
  | "CONNECTION_TIMEOUT"
  | "CERTIFICATE_VERIFICATION_FAILED"
  | "DATABASE_ERROR";

export class DatabaseConnectionError extends Error {
  constructor(
    public readonly databaseCode: DatabaseErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DatabaseConnectionError";
  }
}

function databaseHost(connectionString: string) {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new DatabaseConnectionError("DATABASE_ERROR", "DATABASE_URL is invalid");
  }
}

export function databaseSslConfig(
  connectionString: string,
  modeInput = process.env.DATABASE_SSL_MODE,
  caInput = process.env.DATABASE_SSL_CA,
): PoolConfig["ssl"] {
  const normalized = modeInput?.trim().toLowerCase();
  if (normalized && !["disable", "require", "verify-full"].includes(normalized)) {
    throw new DatabaseConnectionError(
      "DATABASE_ERROR",
      "DATABASE_SSL_MODE must be disable, require, or verify-full",
    );
  }

  const mode = normalized as DatabaseSslMode | undefined;
  const host = databaseHost(connectionString);
  if (mode === "disable" || (!mode && ["localhost", "127.0.0.1", "::1"].includes(host))) {
    return false;
  }
  if (mode === "require") {
    return { rejectUnauthorized: true };
  }
  if (mode === "verify-full") {
    const ca = caInput?.replaceAll("\\n", "\n").trim();
    if (!ca) {
      throw new DatabaseConnectionError(
        "CERTIFICATE_VERIFICATION_FAILED",
        "DATABASE_SSL_CA is required when DATABASE_SSL_MODE=verify-full",
      );
    }
    return { rejectUnauthorized: true, ca };
  }
  return undefined;
}

export function databasePoolConfig(
  connectionString = process.env.DATABASE_URL,
): PoolConfig {
  const normalizedConnectionString = trimmedEnvValue(connectionString) as string | undefined;
  if (!normalizedConnectionString) {
    throw new DatabaseConnectionError("DATABASE_ERROR", "DATABASE_URL is required");
  }
  return {
    connectionString: normalizedConnectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: databaseSslConfig(normalizedConnectionString),
  };
}

export function classifyDatabaseError(error: unknown): DatabaseConnectionError {
  if (error instanceof DatabaseConnectionError) return error;
  const candidate = error as { code?: string; message?: string };
  const code = candidate?.code;
  const message = candidate?.message?.toLowerCase() || "";

  if (code === "ECONNREFUSED") {
    return new DatabaseConnectionError("CONNECTION_REFUSED", "PostgreSQL connection was refused", { cause: error });
  }
  if (
    message.includes("does not support ssl")
    || message.includes("server does not support ssl")
  ) {
    return new DatabaseConnectionError("SSL_UNSUPPORTED", "PostgreSQL server does not support the configured SSL mode", { cause: error });
  }
  if (code === "28P01" || code === "28000") {
    return new DatabaseConnectionError("AUTHENTICATION_FAILED", "PostgreSQL authentication failed", { cause: error });
  }
  if (code === "3D000") {
    return new DatabaseConnectionError("DATABASE_MISSING", "Configured PostgreSQL database does not exist", { cause: error });
  }
  if (code === "42501") {
    return new DatabaseConnectionError(
      "PERMISSION_DENIED", "PostgreSQL permission was denied", { cause: error },
    );
  }
  if (["42P01", "42703", "42883", "42704"].includes(code || "")) {
    return new DatabaseConnectionError(
      "SCHEMA_INCOMPATIBLE", "PostgreSQL schema is incompatible", { cause: error },
    );
  }
  if (code?.startsWith("23")) {
    return new DatabaseConnectionError(
      "CONSTRAINT_VIOLATION", "PostgreSQL rejected data that violates a database constraint", { cause: error },
    );
  }
  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" || message.includes("timeout")) {
    return new DatabaseConnectionError("CONNECTION_TIMEOUT", "PostgreSQL connection timed out", { cause: error });
  }
  if (
    ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code || "")
    || message.includes("certificate")
  ) {
    return new DatabaseConnectionError(
      "CERTIFICATE_VERIFICATION_FAILED",
      "PostgreSQL TLS certificate verification failed",
      { cause: error },
    );
  }
  return new DatabaseConnectionError("DATABASE_ERROR", "PostgreSQL operation failed", { cause: error });
}

function isApplicationError(error: unknown): error is Error {
  const candidate = error as { status?: unknown; code?: unknown };
  return error instanceof Error
    && typeof candidate.status === "number"
    && typeof candidate.code === "string";
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) pool = new Pool(databasePoolConfig());
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  try {
    return await getPool().query<T>(text, values);
  } catch (error) {
    throw classifyDatabaseError(error);
  }
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    throw classifyDatabaseError(error);
  }
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isApplicationError(error)) throw error;
    throw classifyDatabaseError(error);
  } finally {
    client.release();
  }
}

export async function verifyDatabaseStartup() {
  const migrations = await query<{ count: string }>("SELECT count(*)::text count FROM schema_migrations");
  if (Number(migrations.rows[0]?.count || 0) < 11) {
    throw new DatabaseConnectionError("MIGRATION_MISSING", "Required PostgreSQL migrations are missing");
  }
  await query("SELECT 1 FROM auth_nonces LIMIT 1");
}
