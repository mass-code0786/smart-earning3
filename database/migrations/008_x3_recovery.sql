CREATE TABLE x3_pending_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_allocation_id uuid NOT NULL UNIQUE REFERENCES x3_pending_allocations(id),
  resulting_placement_id uuid REFERENCES x3_placement_events(id),
  terminal_income_id uuid REFERENCES x3_income_ledger(id),
  next_pending_allocation_id uuid REFERENCES x3_pending_allocations(id),
  result_status varchar(24) NOT NULL CHECK(result_status IN (
    'WITHDRAWABLE','HELD','CAPPED','ROOT_PENDING','RECYCLE_PENDING'
  )),
  recovery_depth integer NOT NULL CHECK(recovery_depth >= 0),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (terminal_income_id IS NOT NULL)::int
    + (next_pending_allocation_id IS NOT NULL)::int = 1
  )
);

CREATE TABLE x3_recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_allocation_id uuid NOT NULL REFERENCES x3_pending_allocations(id),
  trigger_type varchar(16) NOT NULL CHECK(trigger_type IN ('STARTUP','WORKER','ADMIN')),
  worker_instance varchar(80) NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number > 0),
  status varchar(16) NOT NULL CHECK(status IN ('RECOVERED','FAILED','SKIPPED','LOCKED')),
  error_code varchar(80),
  error_message text,
  duration_ms integer NOT NULL CHECK(duration_ms >= 0),
  previous_step varchar(80),
  resumed_step varchar(80),
  terminal_result varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pending_allocation_id,attempt_number)
);
CREATE INDEX x3_recovery_attempt_status_idx ON x3_recovery_attempts(status,created_at);
CREATE INDEX x3_recovery_pending_idx ON x3_recovery_attempts(pending_allocation_id,created_at);

CREATE TRIGGER x3_pending_resolutions_append_only
BEFORE UPDATE OR DELETE ON x3_pending_resolutions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_recovery_attempts_append_only
BEFORE UPDATE OR DELETE ON x3_recovery_attempts
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
