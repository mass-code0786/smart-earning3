# Phase 3 worker ownership

Production background processing is owned only by the single-instance PM2 applications in `ecosystem.config.cjs`. The Next.js process serves HTTP and health data; it does not start financial workers.

```text
PM2
├─ smart-earning (Next.js; HTTP only)
├─ smart-earning-indexer → chain receipts → projection tables
├─ smart-earning-x3-recovery → due recovery schedule → transactional recovery
├─ smart-earning-booster → due memberships → entries/income/autopool
├─ smart-earning-dividend → missed business date → settlements/ledger
├─ smart-earning-withdrawal → income reservations → signed chain payout
└─ smart-earning-magic-funding → funding outbox → replay-protected chain funding
                         └─ PostgreSQL advisory locks + unique idempotency keys
```

All worker processes use fork mode, one instance, automatic restart with backoff, a 30-second termination window, immediate startup processing, periodic catch-up processing, database heartbeats, and SIGINT/SIGTERM shutdown. PostgreSQL session advisory locks reject duplicate owners; transaction locks and unique idempotency constraints reject duplicate effects after crashes or replays.

## Inventory

| Name / file | Purpose and trigger | Frequency / owner / startup | Tables and chain interaction | Idempotency and locking |
|---|---|---|---|---|
| Blockchain indexer — `scripts/indexer.ts`, `lib/server/blockchain-indexer.ts` | Continuously consumes confirmed contract receipts after startup | `BLOCKCHAIN_INDEXER_POLL_MS`; `smart-earning-indexer`; `tsx scripts/indexer.ts` | Indexer checkpoints, processed logs, projection conflict/audit and projected read-model tables; read-only RPC | Persistent `(chain, contract)` checkpoint/event uniqueness and a two-key session advisory lock |
| X3 recovery — `scripts/x3-recovery-worker.ts`, `lib/server/x3-recovery-worker.ts` | Reclaims due or stale-processing recovery records on startup and interval | `X3_RECOVERY_INTERVAL_SECONDS` (30s default); `smart-earning-x3-recovery` | `x3_recovery_schedule`, attempts, pending resolutions, X3 financial ledgers; no chain write | Global worker lock, per-record advisory and row locks, `SKIP LOCKED`, unique pending resolution, retry backoff and stale `PROCESSING` reclaim |
| Booster — `scripts/booster-worker.ts`, `lib/server/booster-service.ts` | Processes memberships whose next entry is due | `BOOSTER_WORKER_INTERVAL_SECONDS` (60s default); `smart-earning-booster` | Booster membership/scheduler/entry/queue/position/income/wallet/audit tables plus autopool and income ledgers; no chain write | Global worker lock, membership row lock, transaction per user, `(user_id, scheduled_for)` and cycle/source uniqueness |
| Daily dividend — `scripts/dividend-worker.ts`, `lib/server/dividend-service.ts` | Settles the previous business day and catches up every missed date in order | `DAILY_DIVIDEND_WORKER_INTERVAL_SECONDS` (300s default), configured timezone/hour; `smart-earning-dividend` | Dividend package/settlement/allocation/attribution/cap/audit/scheduler tables and income ledger; no chain write | Global worker lock, per-user/date transaction advisory lock, unique user/date settlement and allocation keys; failed dates are retried and history upserted |
| Automatic withdrawal — `scripts/withdrawal-worker.ts`, withdrawal services | Reserves eligible income, broadcasts authorized payout, monitors confirmation, and recovers crash-window broadcasts | `AUTO_WITHDRAW_WORKER_INTERVAL_SECONDS` (60s default); `smart-earning-withdrawal` | `auto_withdrawals`, attempts/audit, income ledger and retry requests; signed `executeWithdrawal` chain write | Global and per-user locks, one-active-withdrawal unique index, deterministic reservation hash and contract replay mapping; `BROADCASTING` rows are reclaimed and chain-processed payouts finalized without rebroadcast |
| Magic funding — `scripts/magic-funding-worker.ts`, `lib/server/magic-funding-service.ts` | Drains due funding outbox records | `MAGIC_FUNDING_WORKER_INTERVAL_SECONDS` (60s default); `smart-earning-magic-funding` | Magic funding event/outbox/wallet ledger and users; replay-protected `fundMagic` chain write | Global worker lock, deterministic source reference, contract `processedMagicFunding`, unique ledger idempotency key, persisted five-minute retry schedule |
| Registration schema readiness monitor — `instrumentation.ts`, `lib/server/registration-schema-readiness.ts` | Non-financial schema-readiness cache refresh | TTL interval; owned by the one-instance web runtime | Schema metadata only; no chain or financial effects | Global in-process singleton; outside Phase 3 financial processing |

`lib/server/booster-worker.ts` is a scheduler factory used by tests/library callers and is not a production startup path. Manual admin actions are HTTP commands, not background owners; the Booster run endpoint uses the same PostgreSQL worker lock and idempotent scheduler implementation.

## Monitoring

`GET /api/admin/operations/workers` returns all heartbeats, current non-stale owners, duplicate-owner detection, heartbeat lag, last successful execution, live advisory-lock state, queue depth, failed jobs, and retry totals. The standalone indexer also publishes lock ownership, checkpoint lag, and last successful scan in its heartbeat metadata. `GET /api/admin/blockchain-indexer/health` remains the detailed indexer diagnostic endpoint.
