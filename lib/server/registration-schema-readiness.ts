import { createHash } from "node:crypto";
import { ApiError } from "./http";
import { classifyDatabaseError, getPool } from "./db";
import { loadAuthoritativeEnvironment, redactDatabaseIdentity } from "./production-environment";

export const HISTORY_MIGRATION = "022_activity_history.sql";
export const HISTORY_REPAIR_MIGRATION = "024_repair_activity_history_schema.sql";
export const REQUIRED_HISTORY_TRIGGERS = [
  "activity_history_append_only",
  "activity_history_package",
  "activity_history_package_attempt",
  "activity_history_booster_topup",
  "activity_history_booster_income",
  "activity_history_referral",
  "activity_history_direct_income",
  "activity_history_magic_income",
  "activity_history_x3_income",
  "activity_history_x3_recycle",
  "activity_history_autopool_position",
  "activity_history_autopool_income",
  "activity_history_dividend",
  "activity_history_withdrawal",
  "activity_history_income_wallet",
  "activity_history_booster_wallet",
  "activity_history_magic_wallet",
] as const;

export const REQUIRED_HISTORY_COLUMNS = [
  "id", "user_wallet", "user_id", "category", "event_type", "title", "status",
  "idempotency_key", "metadata", "occurred_at", "created_at",
] as const;

export type RegistrationSchemaReadiness = {
  checkedAt: string;
  databaseIdentity: ReturnType<typeof redactDatabaseIdentity> | null;
  currentDatabase: string | null;
  currentSchema: string | null;
  searchPath: string | null;
  migration022: boolean;
  repairMigration024: boolean;
  activityHistoryTable: boolean;
  historyFunction: boolean;
  requiredTriggers: string[];
  presentTriggers: string[];
  missingTriggers: string[];
  requiredColumns: string[];
  presentColumns: string[];
  missingColumns: string[];
  fingerprint: string | null;
  registrationReady: boolean;
  failureStage: string | null;
  postgresCode: string | null;
};

const TTL_MS = 60_000;
let cached: RegistrationSchemaReadiness | null = null;
let cachedAt = 0;
let pending: Promise<RegistrationSchemaReadiness> | null = null;
let monitorStarted = false;

function unavailableReadiness(error: unknown): RegistrationSchemaReadiness {
  const classified = classifyDatabaseError(error);
  return {
    checkedAt: new Date().toISOString(),
    databaseIdentity: process.env.DATABASE_URL
      ? redactDatabaseIdentity(process.env.DATABASE_URL) : null,
    currentDatabase: null,
    currentSchema: null,
    searchPath: null,
    migration022: false,
    repairMigration024: false,
    activityHistoryTable: false,
    historyFunction: false,
    requiredTriggers: [...REQUIRED_HISTORY_TRIGGERS],
    presentTriggers: [],
    missingTriggers: [...REQUIRED_HISTORY_TRIGGERS],
    requiredColumns: [...REQUIRED_HISTORY_COLUMNS],
    presentColumns: [],
    missingColumns: [...REQUIRED_HISTORY_COLUMNS],
    fingerprint: null,
    registrationReady: false,
    failureStage: "DATABASE_QUERY",
    postgresCode: (error as { code?: string })?.code || classified.databaseCode,
  };
}

export async function inspectRegistrationSchema(): Promise<RegistrationSchemaReadiness> {
  try {
    loadAuthoritativeEnvironment(process.cwd());
    const identity = await getPool().query<{
      current_database: string;
      current_schema: string;
      search_path: string;
      schema_migrations_table: boolean;
    }>(
      `SELECT current_database() current_database,current_schema() current_schema,
         current_setting('search_path') search_path,
         to_regclass('public.schema_migrations') IS NOT NULL schema_migrations_table`,
    );
    if (!identity.rows[0]?.schema_migrations_table) {
      return {
        ...unavailableReadiness({ code: "MIGRATION_MISSING" }),
        currentDatabase: identity.rows[0]?.current_database || null,
        currentSchema: identity.rows[0]?.current_schema || null,
        searchPath: identity.rows[0]?.search_path || null,
        failureStage: "HISTORY_SCHEMA",
        postgresCode: null,
      };
    }
    const result = await getPool().query<{
      current_database: string;
      current_schema: string;
      search_path: string;
      migration_022: boolean;
      repair_migration_024: boolean;
      history_table: boolean;
      history_function: boolean;
      trigger_names: string[];
      column_names: string[];
    }>(
      `SELECT
         current_database() current_database,
         current_schema() current_schema,
         current_setting('search_path') search_path,
         EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1) migration_022,
         EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$2) repair_migration_024,
         to_regclass('public.activity_history') IS NOT NULL history_table,
         to_regprocedure('public.write_activity_history_from_source()') IS NOT NULL history_function,
         COALESCE(ARRAY(
           SELECT tgname FROM pg_trigger
           WHERE NOT tgisinternal AND tgname=ANY($3::text[]) ORDER BY tgname
         ),ARRAY[]::text[]) trigger_names,
         COALESCE(ARRAY(
           SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='activity_history'
             AND column_name=ANY($4::text[]) ORDER BY column_name
         ),ARRAY[]::text[]) column_names`,
      [HISTORY_MIGRATION, HISTORY_REPAIR_MIGRATION, REQUIRED_HISTORY_TRIGGERS, REQUIRED_HISTORY_COLUMNS],
    );
    const row = result.rows[0];
    const presentTriggers = row?.trigger_names || [];
    const presentColumns = row?.column_names || [];
    const missingTriggers = REQUIRED_HISTORY_TRIGGERS.filter((name) =>
      !presentTriggers.includes(name));
    const missingColumns = REQUIRED_HISTORY_COLUMNS.filter((name) =>
      !presentColumns.includes(name));
    const registrationReady = Boolean(
      row?.migration_022 && row.history_table && row.history_function
      && missingTriggers.length === 0 && missingColumns.length === 0,
    );
    const fingerprintSource = JSON.stringify({
      migrations: [row?.migration_022, row?.repair_migration_024],
      table: row?.history_table,
      function: row?.history_function,
      triggers: presentTriggers,
      columns: presentColumns,
    });
    return {
      checkedAt: new Date().toISOString(),
      databaseIdentity: process.env.DATABASE_URL
        ? redactDatabaseIdentity(process.env.DATABASE_URL) : null,
      currentDatabase: row?.current_database || null,
      currentSchema: row?.current_schema || null,
      searchPath: row?.search_path || null,
      migration022: Boolean(row?.migration_022),
      repairMigration024: Boolean(row?.repair_migration_024),
      activityHistoryTable: Boolean(row?.history_table),
      historyFunction: Boolean(row?.history_function),
      requiredTriggers: [...REQUIRED_HISTORY_TRIGGERS],
      presentTriggers,
      missingTriggers,
      requiredColumns: [...REQUIRED_HISTORY_COLUMNS],
      presentColumns,
      missingColumns,
      fingerprint: createHash("sha256").update(fingerprintSource).digest("hex"),
      registrationReady,
      failureStage: registrationReady ? null : "HISTORY_SCHEMA",
      postgresCode: null,
    };
  } catch (error) {
    return unavailableReadiness(error);
  }
}

export async function getRegistrationSchemaReadiness(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && cached && now - cachedAt < TTL_MS) return cached;
  if (pending) return pending;
  pending = inspectRegistrationSchema().then((value) => {
    cached = value;
    cachedAt = Date.now();
    return value;
  }).finally(() => {
    pending = null;
  });
  return pending;
}

export function invalidateRegistrationSchemaReadiness() {
  cached = null;
  cachedAt = 0;
}

export async function startRegistrationSchemaReadinessMonitor() {
  if (monitorStarted) return;
  monitorStarted = true;
  const refresh = () => void getRegistrationSchemaReadiness({ force: true }).catch((error) => {
    console.error("[registration-schema:refresh]", {
      postgresCode: (error as { code?: string })?.code || null,
    });
  });
  const timer = setInterval(refresh, TTL_MS);
  timer.unref();
  try {
    const client = await getPool().connect();
    client.on("notification", (message) => {
      if (message.channel !== "smart_earning_schema_changed") return;
      invalidateRegistrationSchemaReadiness();
      refresh();
    });
    client.on("error", (error) => {
      console.error("[registration-schema:listener]", {
        postgresCode: (error as { code?: string })?.code || null,
      });
    });
    await client.query("LISTEN smart_earning_schema_changed");
  } catch (error) {
    console.error("[registration-schema:listener]", {
      postgresCode: (error as { code?: string })?.code || null,
    });
  }
}

export async function requireRegistrationSchemaReady() {
  const readiness = await getRegistrationSchemaReadiness();
  if (readiness.registrationReady) return readiness;
  if (readiness.failureStage === "HISTORY_SCHEMA") {
    throw new ApiError(
      503,
      "Registration history dependency is not installed",
      "HISTORY_MIGRATION_MISSING",
    );
  }
  if (["42501", "PERMISSION_DENIED"].includes(readiness.postgresCode || "")) {
    throw new ApiError(503, "Database permission denied", "DATABASE_PERMISSION_DENIED");
  }
  if (["42P01", "42703", "42883", "42704", "SCHEMA_INCOMPATIBLE"]
    .includes(readiness.postgresCode || "")) {
    throw new ApiError(503, "Database schema is incompatible", "DATABASE_SCHEMA_INCOMPATIBLE");
  }
  throw new ApiError(503, "Registration database is unavailable", "DATABASE_UNAVAILABLE");
}

export function resetRegistrationSchemaReadinessForTests() {
  cached = null;
  cachedAt = 0;
  pending = null;
  monitorStarted = false;
}
