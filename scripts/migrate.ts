import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { classifyDatabaseError, getPool } from "../lib/server/db";
import { invalidateRegistrationSchemaReadiness } from "../lib/server/registration-schema-readiness";

const environment = loadAuthoritativeEnvironment(process.cwd());
const productionCheckout = process.cwd().replaceAll("\\", "/") === "/var/www/smart-earning3";
if ((process.env.NODE_ENV === "production" || productionCheckout)
    && process.env.PRODUCTION_DATABASE_SOURCE !== "pm2") {
  throw new Error("Production migrations must be launched with npm run migrate:production");
}

async function main() {
  const directory = resolve("database", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const pool = getPool();
  process.stdout.write(`Migration target: ${JSON.stringify(environment.databaseIdentity)}\n`);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [filename]);
    if (exists.rowCount) continue;
    let sql = await readFile(resolve(directory, filename), "utf8");
    const include = sql.match(/^-- include-migration:([a-zA-Z0-9_.-]+)$/m)?.[1];
    if (include) {
      sql = `${await readFile(resolve(directory, include), "utf8")}\n${sql}`;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT(filename) DO NOTHING",
        [filename],
      );
      await client.query("COMMIT");
      process.stdout.write(`Applied ${filename}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  invalidateRegistrationSchemaReadiness();
  await pool.query("NOTIFY smart_earning_schema_changed");
  await pool.end();
}

main().catch((error) => {
  const diagnostic = classifyDatabaseError(error);
  console.error(`[database:${diagnostic.databaseCode}] ${diagnostic.message}`);
  process.exitCode = 1;
});
