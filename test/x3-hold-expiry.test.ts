// @vitest-environment node
import{readFileSync}from"node:fs";
import{resolve}from"node:path";
import{describe,expect,it}from"vitest";
import{isX3HoldReleaseEligible,X3_HOLD_DURATION_MS,x3HoldExpiresAt}from"@/lib/server/x3-hold-expiry-service";

const source=(file:string)=>readFileSync(resolve(file),"utf8");

describe("X3 Hold exact 48-hour policy",()=>{
 const heldAt=new Date("2026-08-04T08:45:00.000Z"),expiresAt=x3HoldExpiresAt(heldAt);
 it("assigns each hold an independent exact 48-hour expiry",()=>{
  expect(X3_HOLD_DURATION_MS).toBe(172_800_000);
  expect(expiresAt.toISOString()).toBe("2026-08-06T08:45:00.000Z");
  const later=new Date("2026-08-05T04:30:00.000Z");
  expect(x3HoldExpiresAt(later).toISOString()).toBe("2026-08-07T04:30:00.000Z");
 });
 it("releases at 47h59m and immediately before the boundary",()=>{
  expect(isX3HoldReleaseEligible(new Date(heldAt.getTime()+47*3_600_000+59*60_000),expiresAt)).toBe(true);
  expect(isX3HoldReleaseEligible(new Date(expiresAt.getTime()-1),expiresAt)).toBe(true);
 });
 it("flushes at the exact boundary and after 49 hours",()=>{
  expect(isX3HoldReleaseEligible(expiresAt,expiresAt)).toBe(false);
  expect(isX3HoldReleaseEligible(new Date(heldAt.getTime()+49*3_600_000),expiresAt)).toBe(false);
 });
 it("keeps grandfathered NULL-expiry holds eligible under legacy behavior",()=>{
  expect(isX3HoldReleaseEligible(new Date("2036-01-01T00:00:00Z"),null)).toBe(true);
 });
});

describe("X3 Hold persistence and worker safety",()=>{
 const migration=source("database/migrations/028_x3_hold_expiry.sql");
 const service=source("lib/server/x3-hold-expiry-service.ts");
 const x3=source("lib/server/x3-service.ts");
 it("grandfathers existing rows and times only newly inserted holds",()=>{
  expect(migration).not.toMatch(/UPDATE\s+x3_hold_ledger\s+SET\s+expires_at/i);
  expect(migration).toContain("ADD COLUMN expires_at timestamptz");
  expect(x3).toContain("held_at+interval '48 hours'");
 });
 it("adds terminal FLUSHED state, due index and immutable unique expiry history",()=>{
  expect(migration).toContain("'FLUSHED'");
  expect(migration).toContain("x3_hold_due_active_idx");
  expect(migration).toContain("WHERE status='HELD' AND expires_at IS NOT NULL");
  expect(migration).toContain("hold_id uuid NOT NULL UNIQUE");
  expect(migration).toContain("x3_hold_expiry_history_append_only");
 });
 it("uses row locking, DB time, bounded batches and a singleton worker lock",()=>{
  expect(service).toContain("FOR UPDATE SKIP LOCKED LIMIT $1");
  expect(service).toContain("expires_at<=transaction_timestamp()");
  expect(service).toContain("pg_try_advisory_lock(hashtext('x3:hold-expiry:worker'))");
  expect(service).toContain("ON CONFLICT(hold_id) DO NOTHING");
 });
 it("flushes both canonical rows without invoking any earning route",()=>{
  expect(service).toContain("UPDATE x3_hold_ledger SET status='FLUSHED'");
  expect(service).toContain("UPDATE x3_income_ledger SET status='FLUSHED'");
  expect(service).not.toContain("creditGrossEarning");
  expect(service).not.toContain("income_wallet_ledger");
  expect(service).not.toContain("magic_funding");
 });
 it("keeps package matching, locks holds and preserves release accounting identity",()=>{
  expect(x3).toContain("user_id=$1 AND package_id=$2 AND status='HELD'");
  expect(x3).toContain("FOR UPDATE");
  expect(x3).toContain('incomeType:"X3_HOLD_RELEASE"');
  expect(x3).toContain("`x3:hold-release:${hold.id}`");
 });
});

describe("X3 Hold worker supervision",()=>{
 it("is a supervised immediate-start worker with a safe configurable interval",()=>{
  const worker=source("scripts/x3-hold-expiry-worker.ts"),ecosystem=source("ecosystem.config.cjs");
  expect(worker).toContain("X3_HOLD_EXPIRY_WORKER_INTERVAL_SECONDS||60");
  expect(worker).toContain("Math.max(30");
  expect(worker.indexOf("await execute()")).toBeLessThan(worker.indexOf("setInterval"));
  expect(ecosystem).toContain('worker("smart-earning-x3-hold-expiry", "scripts/x3-hold-expiry-worker.ts")');
 });
});
