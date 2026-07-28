import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HISTORY_BACKFILL_SPECS } from "@/lib/server/history-backfill-service";

const sql=readFileSync(resolve("database/migrations/022_activity_history.sql"),"utf8");

describe("activity history migration and backfill",()=>{
 it("enforces append-only unique history and cursor/filter indexes",()=>{
  expect(sql).toContain("idempotency_key varchar(300) NOT NULL UNIQUE");
  expect(sql).toContain("activity_history_append_only");
  for(const index of [
   "activity_history_wallet_occurred_idx","activity_history_category_occurred_idx",
   "activity_history_event_occurred_idx","activity_history_source_wallet_idx",
   "activity_history_tx_hash_idx","activity_history_package_idx","activity_history_status_idx",
   "activity_history_source_record_idx","activity_history_created_idx",
  ])expect(sql).toContain(index);
 });
 it("contains only approved sources and explicitly rejects X4 event types",()=>{
  expect(sql).toContain("upper(event_type) NOT LIKE '%X4%'");
  expect(sql).not.toContain("x4_income_history");
  expect(sql).not.toContain("x4_recycle_history");
 });
 it("backfills every approved durable source without financial mutation",()=>{
  const text=HISTORY_BACKFILL_SPECS.map(spec=>spec.sql).join("\n");
  for(const source of [
   "package_purchases","booster_top_up_history","booster_income_history","referral_relations",
   "direct_income_ledger","magic_income_ledger","x3_income_ledger","x3_recycle_events",
   "autopool_income_history","autopool_positions","daily_dividend_allocations",
   "auto_withdrawals","auto_withdrawal_audit_logs","income_wallet_ledger","booster_wallet_ledger","magic_wallet_ledger",
  ])expect(text).toContain(source);
  expect(text).not.toContain("x4_");
 });
});
