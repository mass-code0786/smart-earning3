ALTER TABLE x3_recovery_schedule
  DROP CONSTRAINT IF EXISTS x3_recovery_schedule_recovery_state_check;

ALTER TABLE x3_recovery_schedule
  ADD CONSTRAINT x3_recovery_schedule_recovery_state_check CHECK(recovery_state IN (
    'PENDING','RETRY_SCHEDULED','PROCESSING','RECOVERED','MANUAL_REVIEW','PAUSED','STALE','INVALID'
  )),
  ADD COLUMN IF NOT EXISTS failure_classification varchar(40)
    CHECK(failure_classification IS NULL OR failure_classification IN (
      'SOURCE_MISSING','COMPLETED_NOOP','TRANSIENT_DEPENDENCY','FINANCIAL_INCONSISTENCY','RETRY_EXHAUSTED'
    )),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz,
  ADD COLUMN IF NOT EXISTS sanitized_error varchar(500),
  ADD COLUMN IF NOT EXISTS source_reference varchar(200);

CREATE INDEX IF NOT EXISTS x3_recovery_classification_idx
  ON x3_recovery_schedule(recovery_state,failure_classification,updated_at);

-- Classify invalid development fixtures created without the recycle event that
-- a real RECYCLE_PENDING allocation always records. This changes queue metadata
-- only; immutable X3 and financial histories are untouched.
UPDATE x3_recovery_schedule s
SET recovery_state='STALE',
    failure_classification='SOURCE_MISSING',
    stale_at=COALESCE(stale_at,now()),
    sanitized_error='RECYCLE_PENDING source recycle event is missing',
    source_reference=p.idempotency_key,
    updated_at=now()
FROM x3_pending_allocations p
WHERE p.id=s.pending_allocation_id
  AND p.status='RECYCLE_PENDING'
  AND p.previous_recycle_event_id IS NULL
  AND s.recovery_state NOT IN('RECOVERED','STALE','INVALID');

UPDATE x3_recovery_schedule s
SET recovery_state='RECOVERED',
    failure_classification='COMPLETED_NOOP',
    completed_at=COALESCE(completed_at,now()),
    sanitized_error=NULL,
    source_reference=COALESCE(source_reference,p.idempotency_key),
    updated_at=now()
FROM x3_pending_allocations p
JOIN x3_pending_resolutions r ON r.pending_allocation_id=p.id
WHERE s.pending_allocation_id=p.id
  AND s.recovery_state<>'RECOVERED';
