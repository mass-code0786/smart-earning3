import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const databaseUrl = process.env.PLACEMENT_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL placement coordination across independent instances", () => {
  it("serializes the same sponsor but not different sponsor lock keys", async () => {
    const firstPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const secondPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const first = await firstPool.connect();
    const second = await secondPool.connect();
    const same = "placement:sponsor:97:contract:sponsor-a";
    const different = "placement:sponsor:97:contract:sponsor-b";
    try {
      expect((await first.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [same],
      )).rows[0].locked).toBe(true);
      expect((await second.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [same],
      )).rows[0].locked).toBe(false);
      expect((await second.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [different],
      )).rows[0].locked).toBe(true);
    } finally {
      await first.query("SELECT pg_advisory_unlock_all()");
      await second.query("SELECT pg_advisory_unlock_all()");
      first.release(); second.release();
      await firstPool.end(); await secondPool.end();
    }
  });
});
