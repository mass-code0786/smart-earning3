import { loadEnvConfig } from "@next/env";

export type RedactedDatabaseIdentity = {
  host: string;
  port: string;
  database: string;
  user: string;
};

let loaded = false;

export function redactDatabaseIdentity(connectionString: string): RedactedDatabaseIdentity {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\/+/, ""),
    user: decodeURIComponent(url.username),
  };
}

export function loadAuthoritativeEnvironment(cwd = process.cwd()) {
  if (!loaded) {
    if (process.env.NODE_ENV !== "production") {
      loadEnvConfig(cwd);
    }
    loaded = true;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production" && !databaseUrl) {
    throw new Error(
      "Production startup refused: DATABASE_URL must be supplied by the process environment",
    );
  }
  return {
    source: process.env.NODE_ENV === "production" ? "process" as const : "process-or-next-env" as const,
    databaseUrl,
    databaseIdentity: databaseUrl ? redactDatabaseIdentity(databaseUrl) : null,
  };
}

export function resetEnvironmentLoaderForTests() {
  loaded = false;
}
