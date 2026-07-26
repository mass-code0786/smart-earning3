CREATE TABLE x3_recovery_schedule (
  pending_allocation_id uuid PRIMARY KEY REFERENCES x3_pending_allocations(id),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error_code varchar(80),
  last_error_message text,
  recovery_state varchar(24) NOT NULL CHECK(recovery_state IN (
    'PENDING','RETRY_SCHEDULED','PROCESSING','RECOVERED','MANUAL_REVIEW','PAUSED'
  )),
  manually_paused_at timestamptz,
  permanently_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX x3_recovery_schedule_due_idx
  ON x3_recovery_schedule(recovery_state,next_attempt_at,pending_allocation_id);

INSERT INTO x3_recovery_schedule(pending_allocation_id,recovery_state,next_attempt_at)
SELECT p.id,
  CASE
    WHEN r.id IS NOT NULL THEN 'RECOVERED'
    WHEN p.status='ROOT_PENDING' THEN 'PAUSED'
    ELSE 'PENDING'
  END,
  now()
FROM x3_pending_allocations p
LEFT JOIN x3_pending_resolutions r ON r.pending_allocation_id=p.id
ON CONFLICT(pending_allocation_id) DO NOTHING;

ALTER TABLE x3_recovery_attempts
  ADD COLUMN error_classification varchar(24)
  CHECK(error_classification IN ('RETRYABLE','NON_RETRYABLE'));
