const fs = require("node:fs");
const path = require("node:path");
const { displayDatabaseUrl, ensureLocalPostgres } = require("./local-postgres.cjs");

const root = path.resolve(__dirname, "..");
const raw = process.env.DATABASE_URL || fs.readFileSync(path.join(root, ".env"), "utf8")
  .split(/\r?\n/).find(line => line.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g, "");

if (!raw) throw new Error("A local PostgreSQL DATABASE_URL is required");
console.log(`[postgres] effective DATABASE_URL=${displayDatabaseUrl(raw)}`);
ensureLocalPostgres(raw)
  .then(result => console.log(`[postgres] ready (${result.action}, ${result.health})`))
  .catch(error => {
    console.error(`[postgres] startup failed: ${error.message}`);
    process.exitCode = 1;
  });
