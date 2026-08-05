-- Canonical direct-referral X3 rollout. Legacy x3_* rows remain immutable audit history.
CREATE TABLE x3_direct_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  boundary_block_number bigint NOT NULL,
  boundary_log_index integer NOT NULL,
  boundary_contract_event_id uuid REFERENCES contract_events(id),
  mode varchar(24) NOT NULL DEFAULT 'TRANSITIONAL' CHECK(mode IN('TRANSITIONAL','CONTRACT_ALIGNED')),
  activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO x3_direct_rollout(boundary_block_number,boundary_log_index,boundary_contract_event_id)
SELECT COALESCE(block_number,0),COALESCE(log_index,-1),id FROM contract_events
WHERE event_name='PackagePurchased' AND status='CONFIRMED'
ORDER BY block_number DESC,log_index DESC,id DESC LIMIT 1;
INSERT INTO x3_direct_rollout(boundary_block_number,boundary_log_index)
SELECT 0,-1 WHERE NOT EXISTS(SELECT 1 FROM x3_direct_rollout);

CREATE TABLE x3_direct_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  cycle_number integer NOT NULL CHECK(cycle_number>0),
  status varchar(16) NOT NULL CHECK(status IN('ACTIVE','COMPLETED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,package_id,cycle_number),
  CHECK((status='ACTIVE' AND completed_at IS NULL) OR (status='COMPLETED' AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX x3_direct_one_active_cycle_idx ON x3_direct_cycles(owner_user_id,package_id) WHERE status='ACTIVE';

CREATE TABLE x3_direct_cycle_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES x3_direct_cycles(id),
  slot_number smallint NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
  buyer_user_id uuid NOT NULL REFERENCES users(id),
  buyer_package_purchase_id uuid NOT NULL UNIQUE REFERENCES package_purchases(id),
  recipient_user_id uuid REFERENCES users(id),
  disposition varchar(24) NOT NULL CHECK(disposition IN('OWNER_INCOME','PASS_UP','GENESIS_RETAINED')),
  gross_amount numeric(78,0) NOT NULL CHECK(gross_amount>0),
  source_contract_event_id uuid NOT NULL REFERENCES contract_events(id),
  transaction_hash varchar(66) NOT NULL,
  block_number bigint NOT NULL,
  log_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id,slot_number),
  CHECK((disposition='GENESIS_RETAINED')=(recipient_user_id IS NULL)),
  CHECK((slot_number<3 AND disposition='OWNER_INCOME') OR (slot_number=3 AND disposition IN('PASS_UP','GENESIS_RETAINED')))
);

CREATE TABLE x3_direct_income_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL UNIQUE REFERENCES x3_direct_cycle_slots(id),
  recipient_user_id uuid REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  gross_amount numeric(78,0) NOT NULL CHECK(gross_amount>0),
  status varchar(24) NOT NULL CHECK(status IN('WITHDRAWABLE','HELD','RELEASED','CAPPED','FLUSHED','GENESIS_RETAINED')),
  credited_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(credited_amount>=0),
  excess_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(excess_amount>=0),
  wallet_ledger_id uuid REFERENCES income_credit_ledger(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK(credited_amount+excess_amount<=gross_amount),
  CHECK((status='GENESIS_RETAINED')=(recipient_user_id IS NULL))
);

ALTER TABLE x3_hold_ledger ALTER COLUMN x3_income_ledger_id DROP NOT NULL;
ALTER TABLE x3_hold_ledger ADD COLUMN x3_direct_income_ledger_id uuid UNIQUE REFERENCES x3_direct_income_ledger(id);
ALTER TABLE x3_hold_ledger ADD CONSTRAINT x3_hold_one_income_source CHECK(
  (x3_income_ledger_id IS NOT NULL)::int+(x3_direct_income_ledger_id IS NOT NULL)::int=1
);

CREATE TABLE x3_direct_cycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cycle_id uuid NOT NULL REFERENCES x3_direct_cycles(id),
  slot_id uuid REFERENCES x3_direct_cycle_slots(id),event_type varchar(24) NOT NULL CHECK(event_type IN('CYCLE_OPENED','SLOT_FILLED','CYCLE_COMPLETED')),
  idempotency_key varchar(200) NOT NULL UNIQUE,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER x3_direct_slots_append_only BEFORE UPDATE OR DELETE ON x3_direct_cycle_slots FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_direct_events_append_only BEFORE UPDATE OR DELETE ON x3_direct_cycle_events FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE OR REPLACE FUNCTION protect_completed_x3_direct_cycle() RETURNS trigger AS $$ BEGIN
  IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'completed direct X3 cycle is immutable'; END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER x3_direct_completed_cycle_immutable BEFORE UPDATE OR DELETE ON x3_direct_cycles FOR EACH ROW EXECUTE FUNCTION protect_completed_x3_direct_cycle();
