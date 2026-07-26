CREATE TABLE booster_memberships (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  last_entry_at timestamptz,
  next_entry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booster_top_up_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  tx_hash varchar(66) NOT NULL UNIQUE,
  token_address varchar(42) NOT NULL,
  sender_address varchar(42) NOT NULL,
  recipient_address varchar(42) NOT NULL,
  amount_token_units numeric(78,0) NOT NULL CHECK(amount_token_units>0),
  block_number bigint NOT NULL,
  confirmations integer NOT NULL CHECK(confirmations>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booster_scheduler_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  scheduled_for timestamptz NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN('COMPLETED','INSUFFICIENT','FAILED')),
  worker_instance varchar(100) NOT NULL,
  error_code varchar(80),
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,scheduled_for)
);

CREATE TABLE booster_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  cycle_number integer NOT NULL CHECK(cycle_number>0),
  scheduler_history_id uuid NOT NULL UNIQUE REFERENCES booster_scheduler_history(id),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMPLETED')),
  parent_entry_id uuid REFERENCES booster_entries(id),
  placement_slot smallint CHECK(placement_slot BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(owner_user_id,cycle_number),
  CHECK((parent_entry_id IS NULL)=(placement_slot IS NULL)),
  CHECK((status='COMPLETED')=(completed_at IS NOT NULL))
);

CREATE TABLE booster_global_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE REFERENCES booster_entries(id),
  queue_sequence bigint NOT NULL UNIQUE CHECK(queue_sequence>0),
  status varchar(16) NOT NULL DEFAULT 'WAITING' CHECK(status IN('WAITING','FILLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((status='FILLED')=(completed_at IS NOT NULL))
);

CREATE TABLE booster_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entry_id uuid NOT NULL REFERENCES booster_entries(id),
  slot_number smallint NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
  placed_entry_id uuid NOT NULL UNIQUE REFERENCES booster_entries(id),
  placed_user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_entry_id,slot_number)
);

CREATE TABLE booster_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  direction ledger_direction NOT NULL,
  amount_token_units numeric(78,0) NOT NULL CHECK(amount_token_units>0),
  reason varchar(40) NOT NULL CHECK(reason IN('PACKAGE_CREDIT','MANUAL_TOP_UP','C_POSITION_REFUND','ENTRY_DEDUCTION')),
  package_purchase_id uuid REFERENCES package_purchases(id),
  top_up_id uuid REFERENCES booster_top_up_history(id),
  entry_id uuid REFERENCES booster_entries(id),
  position_id uuid REFERENCES booster_positions(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booster_income_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  owner_entry_id uuid NOT NULL REFERENCES booster_entries(id),
  position_id uuid NOT NULL UNIQUE REFERENCES booster_positions(id),
  slot_number smallint NOT NULL CHECK(slot_number IN(1,2)),
  gross_amount numeric(78,0) NOT NULL CHECK(gross_amount=2000000),
  credited_amount numeric(78,0) NOT NULL CHECK(credited_amount>=0),
  excess_amount numeric(78,0) NOT NULL CHECK(excess_amount>=0),
  income_credit_ledger_id uuid NOT NULL REFERENCES income_credit_ledger(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(gross_amount=credited_amount+excess_amount)
);

CREATE TABLE booster_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(40) NOT NULL,
  user_id uuid REFERENCES users(id),
  entry_id uuid REFERENCES booster_entries(id),
  position_id uuid REFERENCES booster_positions(id),
  idempotency_key varchar(180) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX booster_wallet_user_idx ON booster_wallet_ledger(user_id,created_at DESC);
CREATE INDEX booster_memberships_due_idx ON booster_memberships(next_entry_at);
CREATE INDEX booster_entries_owner_idx ON booster_entries(owner_user_id,cycle_number DESC);
CREATE INDEX booster_entries_status_idx ON booster_entries(status,created_at);
CREATE INDEX booster_queue_next_idx ON booster_global_queue(status,queue_sequence);
CREATE INDEX booster_positions_owner_idx ON booster_positions(owner_entry_id,slot_number);
CREATE INDEX booster_income_owner_idx ON booster_income_history(owner_user_id,created_at DESC);
CREATE INDEX booster_topups_user_idx ON booster_top_up_history(user_id,created_at DESC);
CREATE INDEX booster_scheduler_user_idx ON booster_scheduler_history(user_id,created_at DESC);
CREATE INDEX booster_audit_user_idx ON booster_audit_logs(user_id,created_at DESC);

CREATE TRIGGER booster_wallet_append_only BEFORE UPDATE OR DELETE ON booster_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER booster_topups_append_only BEFORE UPDATE OR DELETE ON booster_top_up_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER booster_positions_append_only BEFORE UPDATE OR DELETE ON booster_positions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER booster_income_append_only BEFORE UPDATE OR DELETE ON booster_income_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER booster_scheduler_append_only BEFORE UPDATE OR DELETE ON booster_scheduler_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER booster_audit_append_only BEFORE UPDATE OR DELETE ON booster_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
