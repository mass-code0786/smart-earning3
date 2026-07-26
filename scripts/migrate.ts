import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { classifyDatabaseError, getPool } from "../lib/server/db";

loadEnvConfig(process.cwd());

async function main() {
  const directory = resolve("database", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [filename]);
    if (exists.rowCount) continue;
    const sql = await readFile(resolve(directory, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${filename}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((error) => {
  const diagnostic = classifyDatabaseError(error);
  console.error(`[database:${diagnostic.databaseCode}] ${diagnostic.message}`);
  process.exitCode = 1;
});
