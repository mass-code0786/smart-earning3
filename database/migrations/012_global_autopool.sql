CREATE TABLE autopool_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  booster_entry_id uuid NOT NULL UNIQUE REFERENCES booster_entries(id),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','COMPLETED')),
  filled_positions smallint NOT NULL DEFAULT 0 CHECK(filled_positions BETWEEN 0 AND 242),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK((status='COMPLETED')=(completed_at IS NOT NULL)),
  CHECK(status<>'COMPLETED' OR filled_positions=242)
);

CREATE TABLE autopool_global_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE REFERENCES autopool_entries(id),
  queue_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE autopool_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entry_id uuid NOT NULL REFERENCES autopool_entries(id),
  placed_entry_id uuid NOT NULL REFERENCES autopool_entries(id),
  placed_user_id uuid NOT NULL REFERENCES users(id),
  position_number smallint NOT NULL CHECK(position_number BETWEEN 1 AND 242),
  matrix_level smallint NOT NULL CHECK(matrix_level BETWEEN 1 AND 5),
  level_position smallint NOT NULL CHECK(level_position>0),
  parent_position_number smallint CHECK(parent_position_number BETWEEN 1 AND 80),
  child_slot smallint NOT NULL CHECK(child_slot BETWEEN 1 AND 3),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_entry_id,position_number),
  UNIQUE(placed_entry_id),
  CHECK(owner_entry_id<>placed_entry_id)
);

CREATE TABLE autopool_income_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  owner_entry_id uuid NOT NULL REFERENCES autopool_entries(id),
  position_id uuid NOT NULL UNIQUE REFERENCES autopool_positions(id),
  matrix_level smallint NOT NULL CHECK(matrix_level BETWEEN 1 AND 5),
  gross_amount numeric(78,0) NOT NULL CHECK(gross_amount=100000),
  credited_amount numeric(78,0) NOT NULL CHECK(credited_amount>=0),
  excess_amount numeric(78,0) NOT NULL CHECK(excess_amount>=0),
  income_credit_ledger_id uuid NOT NULL REFERENCES income_credit_ledger(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(gross_amount=credited_amount+excess_amount)
);

CREATE TABLE autopool_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(48) NOT NULL,
  user_id uuid REFERENCES users(id),
  entry_id uuid REFERENCES autopool_entries(id),
  position_id uuid REFERENCES autopool_positions(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX autopool_entries_owner_idx ON autopool_entries(owner_user_id,created_at DESC);
CREATE INDEX autopool_entries_status_idx ON autopool_entries(status,created_at);
CREATE INDEX autopool_queue_sequence_idx ON autopool_global_queue(queue_sequence);
CREATE INDEX autopool_positions_owner_level_idx ON autopool_positions(owner_entry_id,matrix_level,position_number);
CREATE INDEX autopool_positions_placed_idx ON autopool_positions(placed_entry_id);
CREATE INDEX autopool_income_owner_idx ON autopool_income_history(owner_user_id,created_at DESC);
CREATE INDEX autopool_income_level_idx ON autopool_income_history(matrix_level,created_at DESC);
CREATE INDEX autopool_audit_created_idx ON autopool_audit_logs(created_at DESC);

CREATE TRIGGER autopool_queue_append_only BEFORE UPDATE OR DELETE ON autopool_global_queue
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER autopool_positions_append_only BEFORE UPDATE OR DELETE ON autopool_positions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER autopool_income_append_only BEFORE UPDATE OR DELETE ON autopool_income_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER autopool_audit_append_only BEFORE UPDATE OR DELETE ON autopool_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
