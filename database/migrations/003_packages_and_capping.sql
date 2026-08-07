CREATE TABLE package_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number smallint NOT NULL UNIQUE CHECK (serial_number BETWEEN 1 AND 8),
  name varchar(40) NOT NULL,
  price_token_units numeric(78,0) NOT NULL CHECK (price_token_units > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO package_definitions(serial_number,name,price_token_units) VALUES
  (1,'1st Package',8000000),
  (2,'2nd Package',16000000),
  (3,'3rd Package',32000000),
  (4,'4th Package',64000000),
  (5,'5th Package',128000000),
  (6,'6th Package',256000000),
  (7,'7th Package',512000000),
  (8,'8th Package',1024000000);

CREATE TABLE package_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  wallet_address varchar(42) NOT NULL,
  package_definition_id uuid NOT NULL REFERENCES package_definitions(id),
  package_id smallint NOT NULL CHECK (package_id BETWEEN 1 AND 8),
  amount_token_units numeric(78,0) NOT NULL CHECK (amount_token_units > 0),
  tx_hash varchar(66) NOT NULL UNIQUE,
  block_number bigint,
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','CONFIRMED','FAILED','REORGED')),
  failure_reason text,
  purchased_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_purchase_user_package_unique UNIQUE(user_id,package_id)
);
CREATE INDEX package_purchase_status_idx ON package_purchases(status,created_at);

CREATE TABLE package_purchase_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  wallet_address varchar(42) NOT NULL,
  package_id smallint CHECK (package_id BETWEEN 1 AND 8),
  amount_token_units numeric(78,0),
  tx_hash varchar(66) NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN (
    'PENDING','FAILED','CONFIRMED','DUPLICATE','WRONG_WALLET','WRONG_PACKAGE','WRONG_AMOUNT'
  )),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_attempt_idempotent UNIQUE(tx_hash,status)
);

CREATE TABLE user_package_states (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  highest_package_id smallint NOT NULL DEFAULT 0 CHECK (highest_package_id BETWEEN 0 AND 8),
  total_package_value numeric(78,0) NOT NULL DEFAULT 0 CHECK (total_package_value >= 0),
  registration_value numeric(78,0) NOT NULL CHECK (registration_value > 0),
  total_eligible_value numeric(78,0) NOT NULL CHECK (total_eligible_value >= 0),
  total_earning_cap numeric(78,0) NOT NULL CHECK (total_earning_cap >= 0),
  total_earned numeric(78,0) NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  remaining_cap numeric(78,0) NOT NULL CHECK (remaining_cap >= 0),
  capping_status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (capping_status IN ('ACTIVE','NEAR_CAP','CAPPED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_state_cap_math CHECK (remaining_cap = GREATEST(total_earning_cap-total_earned,0))
);

CREATE TABLE earning_cap_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  source_type varchar(40) NOT NULL,
  source_reference varchar(160) NOT NULL,
  eligible_value numeric(78,0) NOT NULL CHECK (eligible_value > 0),
  cap_multiplier smallint NOT NULL DEFAULT 5 CHECK (cap_multiplier = 5),
  cap_increase numeric(78,0) NOT NULL CHECK (cap_increase > 0),
  total_cap_after numeric(78,0) NOT NULL CHECK (total_cap_after >= cap_increase),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earning_cap_source_unique UNIQUE(source_type,source_reference)
);
CREATE INDEX earning_cap_user_idx ON earning_cap_ledger(user_id,created_at);

CREATE TABLE income_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  income_type varchar(64) NOT NULL,
  source_reference varchar(160) NOT NULL,
  calculated_amount numeric(78,0) NOT NULL CHECK (calculated_amount > 0),
  credited_amount numeric(78,0) NOT NULL CHECK (credited_amount >= 0),
  excess_amount numeric(78,0) NOT NULL CHECK (excess_amount >= 0),
  total_earned_after numeric(78,0) NOT NULL CHECK (total_earned_after >= 0),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_credit_split CHECK (calculated_amount=credited_amount+excess_amount)
);
CREATE INDEX income_credit_user_idx ON income_credit_ledger(user_id,created_at);

CREATE TABLE capped_excess_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  income_type varchar(64) NOT NULL,
  source_reference varchar(160) NOT NULL,
  calculated_amount numeric(78,0) NOT NULL CHECK (calculated_amount > 0),
  credited_amount numeric(78,0) NOT NULL CHECK (credited_amount >= 0),
  excess_amount numeric(78,0) NOT NULL CHECK (excess_amount > 0),
  status varchar(24) NOT NULL DEFAULT 'CAPPED_EXCESS' CHECK (status='CAPPED_EXCESS'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capped_excess_source_unique UNIQUE(income_type,source_reference),
  CONSTRAINT capped_excess_split CHECK (calculated_amount=credited_amount+excess_amount)
);

CREATE TABLE contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  tx_hash varchar(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash varchar(66) NOT NULL,
  event_name varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('SEEN','CONFIRMED','REORGED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_event_unique UNIQUE(chain_id,tx_hash,log_index)
);

INSERT INTO user_package_states(
  user_id,registration_value,total_eligible_value,total_earning_cap,total_earned,remaining_cap,capping_status
)
SELECT
  u.id,
  r.amount_token_units,
  0,
  0,
  0,
  0,
  'CAPPED'
FROM users u
JOIN registrations r ON r.user_id=u.id AND r.status='CONFIRMED'
ON CONFLICT(user_id) DO NOTHING;

CREATE TRIGGER earning_cap_ledger_append_only
BEFORE UPDATE OR DELETE ON earning_cap_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER package_purchase_attempts_append_only
BEFORE UPDATE OR DELETE ON package_purchase_attempts
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER income_credit_ledger_append_only
BEFORE UPDATE OR DELETE ON income_credit_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER capped_excess_ledger_append_only
BEFORE UPDATE OR DELETE ON capped_excess_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER contract_events_append_only
BEFORE UPDATE OR DELETE ON contract_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
