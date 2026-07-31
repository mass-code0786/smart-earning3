import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Wallet } from "ethers";
import { SignJWT } from "jose";
import { Pool } from "pg";

type WorkloadResult = {
  name: string;
  count: number;
  failures: number;
  rejected: number;
  statuses: Record<string, number>;
  latencyMs: { min: number; p50: number; p95: number; max: number };
};

async function runBatch(
  name: string,
  count: number,
  request: (index: number) => Promise<Response>,
): Promise<WorkloadResult> {
  const latencies: number[] = [];
  const statuses: number[] = [];

  await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const started = performance.now();
      try {
        const response = await request(index);
        statuses.push(response.status);
        await response.arrayBuffer();
      } catch {
        statuses.push(0);
      } finally {
        latencies.push(performance.now() - started);
      }
    }),
  );

  latencies.sort((left, right) => left - right);
  return {
    name,
    count,
    failures: statuses.filter((status) => status === 0 || status >= 500).length,
    rejected: statuses.filter((status) => status >= 400 && status < 500).length,
    statuses: Object.fromEntries(
      [...new Set(statuses)].map((status) => [
        String(status),
        statuses.filter((value) => value === status).length,
      ]),
    ),
    latencyMs: {
      min: Number(latencies[0].toFixed(1)),
      p50: Number(latencies[Math.floor(count * 0.5)].toFixed(1)),
      p95: Number(latencies[Math.min(count - 1, Math.floor(count * 0.95))].toFixed(1)),
      max: Number(latencies[count - 1].toFixed(1)),
    },
  };
}

async function main() {
  const origin = process.env.PERFORMANCE_ORIGIN ?? "http://127.0.0.1:3020";
  const url = new URL(origin);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Performance audit refuses non-local origins");
  }
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error("DATABASE_URL and SESSION_SECRET are required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const encoder = new TextEncoder();
    const createToken = (walletAddress: string) =>
      new SignJWT({
        wallet: walletAddress,
        chainId: Number(process.env.SMART_EARNING_CHAIN_ID ?? 31337),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(walletAddress)
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(encoder.encode(process.env.SESSION_SECRET));

    const user = (
      await pool.query<{ wallet_address: string }>(
        "SELECT wallet_address FROM users WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1",
      )
    ).rows[0]?.wallet_address;
    const admin = (
      await pool.query<{ wallet_address: string }>(
        "SELECT wallet_address FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1",
      )
    ).rows[0]?.wallet_address;
    if (!user || !admin) {
      throw new Error("Performance audit requires active user and admin fixtures");
    }

    const userToken = await createToken(user);
    const adminToken = await createToken(admin);
    const authHeaders = (walletAddress: string, token: string) => ({
      cookie: `se_session=${token}`,
      "x-connected-wallet": walletAddress,
    });

    const dashboard = await runBatch("dashboard", 50, () =>
      fetch(`${origin}/api/dashboard`, { headers: authHeaders(user, userToken) }),
    );
    const wallet = await runBatch("wallet", 50, () =>
      fetch(`${origin}/api/wallet`, { headers: authHeaders(user, userToken) }),
    );

    const sponsor = process.env.PERFORMANCE_SPONSOR_WALLET ?? admin;
    const registrants = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const address = Wallet.createRandom().address.toLowerCase();
        return { address, token: await createToken(address) };
      }),
    );
    const registrations = await runBatch("registration-prepare", 10, (index) =>
      fetch(`${origin}/api/registrations/prepare`, {
        method: "POST",
        headers: {
          ...authHeaders(registrants[index].address, registrants[index].token),
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sponsor,
          requestKey: `perf:${randomBytes(16).toString("hex")}`,
        }),
      }),
    );
    const indexer = await runBatch("indexer-health", 20, () =>
      fetch(`${origin}/api/admin/blockchain-indexer/health`, {
        headers: authHeaders(admin, adminToken),
      }),
    );

    const database = (
      await pool.query<{ active: string; waiting: string }>(
        "SELECT count(*) FILTER (WHERE state = 'active')::text active, " +
          "count(*) FILTER (WHERE wait_event IS NOT NULL)::text waiting " +
          "FROM pg_stat_activity WHERE datname = current_database()",
      )
    ).rows[0];
    const report = {
      generatedAt: new Date().toISOString(),
      origin,
      workloads: [registrations, dashboard, wallet, indexer],
      database: {
        active: Number(database.active),
        waiting: Number(database.waiting),
      },
    };

    mkdirSync(resolve("evidence/phase-4"), { recursive: true });
    writeFileSync(
      resolve("evidence/phase-4/performance.json"),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.workloads.some((item) => item.failures > 0)) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 2;
});
