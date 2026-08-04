-- Existing rows are deliberately grandfathered by leaving expires_at NULL.
ALTER TABLE package_purchases ADD COLUMN confirmed_block_at timestamptz;

ALTER TABLE x3_hold_ledger ADD COLUMN expires_at timestamptz;
ALTER TABLE x3_hold_ledger ADD COLUMN flushed_at timestamptz;
ALTER TABLE x3_hold_ledger DROP CONSTRAINT IF EXISTS x3_hold_ledger_status_check;
ALTER TABLE x3_hold_ledger ADD CONSTRAINT x3_hold_ledger_status_check
  CHECK(status IN ('HELD','RELEASED','PARTIALLY_CAPPED','FLUSHED'));
ALTER TABLE x3_hold_ledger ADD CONSTRAINT x3_hold_expiry_consistency CHECK (
  (expires_at IS NULL AND flushed_at IS NULL)
  OR (expires_at=held_at+interval '48 hours' AND (status='FLUSHED')=(flushed_at IS NOT NULL))
);

ALTER TABLE x3_income_ledger DROP CONSTRAINT IF EXISTS x3_income_ledger_status_check;
ALTER TABLE x3_income_ledger ADD CONSTRAINT x3_income_ledger_status_check
  CHECK(status IN ('WITHDRAWABLE','HELD','RELEASED','CAPPED','RECYCLE','FLUSHED'));

CREATE INDEX x3_hold_due_active_idx ON x3_hold_ledger(status,expires_at)
  WHERE status='HELD' AND expires_at IS NOT NULL;

CREATE TABLE x3_hold_expiry_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL UNIQUE REFERENCES x3_hold_ledger(id),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  amount numeric(78,0) NOT NULL CHECK(amount>0),
  held_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  flushed_at timestamptz NOT NULL,
  trigger_type varchar(16) NOT NULL CHECK(trigger_type IN ('WORKER','PACKAGE')),
  worker_instance varchar(120),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expires_at=held_at+interval '48 hours'),
  CHECK(flushed_at>=expires_at)
);
CREATE TRIGGER x3_hold_expiry_history_append_only BEFORE UPDATE OR DELETE ON x3_hold_expiry_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
