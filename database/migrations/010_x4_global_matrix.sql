CREATE TABLE x4_package_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  activation_purchase_id uuid NOT NULL UNIQUE REFERENCES package_purchases(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, package_id)
);

CREATE TABLE x4_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED')),
  parent_cycle_id uuid REFERENCES x4_cycles(id),
  placement_slot smallint CHECK (placement_slot BETWEEN 1 AND 6),
  recycled_from_cycle_id uuid UNIQUE REFERENCES x4_cycles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, package_id, cycle_number),
  CHECK ((parent_cycle_id IS NULL) = (placement_slot IS NULL)),
  CHECK ((status='COMPLETED') = (completed_at IS NOT NULL))
);

CREATE TABLE x4_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  cycle_id uuid NOT NULL UNIQUE REFERENCES x4_cycles(id),
  queue_sequence bigint NOT NULL CHECK (queue_sequence > 0),
  status varchar(16) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','FILLED')),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  filled_at timestamptz,
  UNIQUE(package_id, queue_sequence),
  CHECK ((status='FILLED') = (filled_at IS NOT NULL))
);

CREATE TABLE x4_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  owner_cycle_id uuid NOT NULL REFERENCES x4_cycles(id),
  slot_number smallint NOT NULL CHECK (slot_number BETWEEN 1 AND 6),
  level_number smallint NOT NULL CHECK (level_number IN (1,2)),
  placed_cycle_id uuid NOT NULL UNIQUE REFERENCES x4_cycles(id),
  placed_user_id uuid NOT NULL REFERENCES users(id),
  source_package_purchase_id uuid REFERENCES package_purchases(id),
  placement_type varchar(16) NOT NULL CHECK (placement_type IN ('PURCHASE','RECYCLE')),
  source_transaction_hash varchar(66) NOT NULL,
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_cycle_id, slot_number),
  CHECK ((slot_number <= 2 AND level_number=1) OR (slot_number >= 3 AND level_number=2))
);

CREATE TABLE x4_income_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  owner_cycle_id uuid NOT NULL REFERENCES x4_cycles(id),
  position_id uuid NOT NULL UNIQUE REFERENCES x4_positions(id),
  level_number smallint NOT NULL CHECK (level_number IN (1,2)),
  wallet_type varchar(20) NOT NULL CHECK (wallet_type IN ('MAGIC_LEVEL','EARNING')),
  gross_amount numeric(78,0) NOT NULL CHECK (gross_amount > 0),
  credited_amount numeric(78,0) NOT NULL CHECK (credited_amount >= 0),
  excess_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK (excess_amount >= 0),
  magic_wallet_ledger_id uuid REFERENCES magic_wallet_ledger(id),
  income_credit_ledger_id uuid REFERENCES income_credit_ledger(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_amount=credited_amount+excess_amount),
  CHECK (
    (wallet_type='MAGIC_LEVEL' AND magic_wallet_ledger_id IS NOT NULL AND income_credit_ledger_id IS NULL)
    OR (wallet_type='EARNING' AND magic_wallet_ledger_id IS NULL AND income_credit_ledger_id IS NOT NULL)
  )
);

CREATE TABLE x4_recycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  user_id uuid NOT NULL REFERENCES users(id),
  completed_cycle_id uuid NOT NULL UNIQUE REFERENCES x4_cycles(id),
  new_cycle_id uuid NOT NULL UNIQUE REFERENCES x4_cycles(id),
  recycle_number integer NOT NULL CHECK (recycle_number > 0),
  triggering_position_id uuid NOT NULL REFERENCES x4_positions(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE x4_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(40) NOT NULL,
  package_id smallint NOT NULL REFERENCES package_definitions(serial_number),
  user_id uuid REFERENCES users(id),
  cycle_id uuid REFERENCES x4_cycles(id),
  position_id uuid REFERENCES x4_positions(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX x4_cycles_user_package_idx ON x4_cycles(user_id,package_id,cycle_number DESC);
CREATE INDEX x4_cycles_status_idx ON x4_cycles(package_id,status,opened_at);
CREATE INDEX x4_queue_next_idx ON x4_queue(package_id,status,queue_sequence);
CREATE INDEX x4_positions_owner_idx ON x4_positions(owner_cycle_id,slot_number);
CREATE INDEX x4_income_owner_idx ON x4_income_history(owner_user_id,package_id,created_at DESC);
CREATE INDEX x4_recycles_user_idx ON x4_recycle_history(user_id,package_id,created_at DESC);
CREATE INDEX x4_audit_package_idx ON x4_audit_logs(package_id,created_at DESC);

CREATE TRIGGER x4_positions_append_only BEFORE UPDATE OR DELETE ON x4_positions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x4_income_append_only BEFORE UPDATE OR DELETE ON x4_income_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x4_recycles_append_only BEFORE UPDATE OR DELETE ON x4_recycle_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x4_audit_append_only BEFORE UPDATE OR DELETE ON x4_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
