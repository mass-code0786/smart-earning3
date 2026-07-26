CREATE TABLE x3_package_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  activation_purchase_id uuid NOT NULL UNIQUE REFERENCES package_purchases(id),
  activated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,package_id)
);

CREATE TABLE x3_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  cycle_number integer NOT NULL CHECK(cycle_number > 0),
  status varchar(16) NOT NULL CHECK(status IN ('ACTIVE','COMPLETED')),
  sponsor_user_id uuid NOT NULL REFERENCES users(id),
  matrix_parent_user_id uuid REFERENCES users(id),
  parent_cycle_id uuid REFERENCES x3_cycles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  recycled_from_cycle_id uuid UNIQUE REFERENCES x3_cycles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,package_id,cycle_number),
  CHECK(user_id <> COALESCE(matrix_parent_user_id,'00000000-0000-0000-0000-000000000000'::uuid))
);
CREATE INDEX x3_cycles_package_parent_idx ON x3_cycles(package_id,parent_cycle_id);
CREATE INDEX x3_cycles_user_package_idx ON x3_cycles(user_id,package_id,cycle_number DESC);

CREATE TABLE x3_cycle_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES x3_cycles(id),
  slot_number smallint NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
  placed_user_id uuid NOT NULL REFERENCES users(id),
  placed_user_purchase_id uuid REFERENCES package_purchases(id),
  placed_user_cycle_id uuid NOT NULL UNIQUE REFERENCES x3_cycles(id),
  placement_type varchar(16) NOT NULL CHECK(placement_type IN ('DIRECT','SPILLOVER','RECYCLE')),
  x3_allocation_amount numeric(78,0) NOT NULL CHECK(x3_allocation_amount >= 0),
  source_transaction_hash varchar(66) NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cycle_id,slot_number)
);

CREATE TABLE x3_income_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  owner_cycle_id uuid NOT NULL REFERENCES x3_cycles(id),
  slot_id uuid NOT NULL UNIQUE REFERENCES x3_cycle_slots(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  source_package_purchase_id uuid REFERENCES package_purchases(id),
  gross_amount numeric(78,0) NOT NULL CHECK(gross_amount > 0),
  status varchar(16) NOT NULL CHECK(status IN ('WITHDRAWABLE','HELD','RELEASED','CAPPED','RECYCLE')),
  credited_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(credited_amount >= 0),
  excess_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(excess_amount >= 0),
  wallet_ledger_id uuid REFERENCES income_credit_ledger(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK(credited_amount + excess_amount <= gross_amount)
);
CREATE INDEX x3_income_owner_package_idx ON x3_income_ledger(owner_user_id,package_id,created_at);

CREATE TABLE x3_hold_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  x3_income_ledger_id uuid NOT NULL UNIQUE REFERENCES x3_income_ledger(id),
  amount numeric(78,0) NOT NULL CHECK(amount > 0),
  status varchar(24) NOT NULL CHECK(status IN ('HELD','RELEASED','PARTIALLY_CAPPED')),
  release_purchase_id uuid REFERENCES package_purchases(id),
  released_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(released_amount >= 0),
  excess_amount numeric(78,0) NOT NULL DEFAULT 0 CHECK(excess_amount >= 0),
  held_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK(released_amount + excess_amount <= amount)
);
CREATE INDEX x3_hold_user_package_status_idx ON x3_hold_ledger(user_id,package_id,status);

CREATE TABLE x3_placement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  cycle_id uuid NOT NULL REFERENCES x3_cycles(id),
  placed_user_id uuid NOT NULL REFERENCES users(id),
  matrix_parent_user_id uuid NOT NULL REFERENCES users(id),
  sponsor_user_id uuid NOT NULL REFERENCES users(id),
  placement_type varchar(16) NOT NULL CHECK(placement_type IN ('DIRECT','SPILLOVER','RECYCLE')),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  transaction_hash varchar(66) NOT NULL,
  block_number bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX x3_placement_package_parent_idx ON x3_placement_events(package_id,matrix_parent_user_id,created_at);

CREATE TABLE x3_recycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  completed_cycle_id uuid NOT NULL UNIQUE REFERENCES x3_cycles(id),
  new_cycle_id uuid NOT NULL UNIQUE REFERENCES x3_cycles(id),
  user_id uuid NOT NULL REFERENCES users(id),
  recycle_number integer NOT NULL CHECK(recycle_number > 0),
  placement_event_id uuid REFERENCES x3_placement_events(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,package_id,recycle_number)
);

CREATE TABLE x3_package_reserve_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_purchase_id uuid NOT NULL UNIQUE REFERENCES package_purchases(id),
  user_id uuid NOT NULL REFERENCES users(id),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  package_amount numeric(78,0) NOT NULL CHECK(package_amount > 0),
  x3_allocation numeric(78,0) NOT NULL CHECK(x3_allocation > 0),
  reserved_amount numeric(78,0) NOT NULL CHECK(reserved_amount > 0),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(package_amount = x3_allocation + reserved_amount),
  CHECK(x3_allocation * 4 = package_amount)
);

CREATE TRIGGER x3_cycle_slots_append_only BEFORE UPDATE OR DELETE ON x3_cycle_slots
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_placement_events_append_only BEFORE UPDATE OR DELETE ON x3_placement_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_recycle_events_append_only BEFORE UPDATE OR DELETE ON x3_recycle_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_package_reserve_append_only BEFORE UPDATE OR DELETE ON x3_package_reserve_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE OR REPLACE FUNCTION protect_completed_x3_cycle() RETURNS trigger AS $$
BEGIN
  IF OLD.status='COMPLETED' THEN
    RAISE EXCEPTION 'completed X3 cycle history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER x3_completed_cycle_immutable BEFORE UPDATE OR DELETE ON x3_cycles
FOR EACH ROW EXECUTE FUNCTION protect_completed_x3_cycle();
