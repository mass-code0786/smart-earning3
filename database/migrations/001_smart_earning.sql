CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE registration_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
CREATE TYPE ledger_direction AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE distribution_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE blockchain_tx_status AS ENUM ('SEEN', 'CONFIRMED', 'FAILED', 'REORGED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar(42) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  role varchar(16) NOT NULL DEFAULT 'USER',
  direct_count integer NOT NULL DEFAULT 0 CHECK (direct_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  CONSTRAINT users_wallet_lowercase CHECK (wallet_address = lower(wallet_address)),
  CONSTRAINT users_wallet_unique UNIQUE (wallet_address)
);

CREATE TABLE auth_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address varchar(42) NOT NULL,
  nonce_hash varchar(64) NOT NULL UNIQUE,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_nonces_wallet_idx ON auth_nonces(wallet_address, created_at DESC);

CREATE TABLE blockchain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  tx_hash varchar(66) NOT NULL,
  block_number bigint,
  block_hash varchar(66),
  from_address varchar(42),
  to_address varchar(42),
  event_name varchar(80),
  log_index integer,
  status blockchain_tx_status NOT NULL DEFAULT 'SEEN',
  confirmations integer NOT NULL DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT blockchain_tx_unique UNIQUE(chain_id, tx_hash, log_index)
);

CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  sponsor_user_id uuid NOT NULL REFERENCES users(id),
  tx_hash varchar(66) NOT NULL UNIQUE,
  chain_id integer NOT NULL,
  amount_token_units numeric(78,0) NOT NULL CHECK (amount_token_units > 0),
  status registration_status NOT NULL DEFAULT 'PENDING',
  block_number bigint,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE referral_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  sponsor_user_id uuid NOT NULL REFERENCES users(id),
  registration_id uuid NOT NULL UNIQUE REFERENCES registrations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_referral CHECK (user_id <> sponsor_user_id)
);
CREATE INDEX referral_sponsor_idx ON referral_relations(sponsor_user_id, created_at);

CREATE TABLE matrix_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  parent_user_id uuid REFERENCES users(id),
  position smallint CHECK (position IN (0, 1)),
  bfs_index bigint NOT NULL UNIQUE CHECK (bfs_index >= 0),
  registration_id uuid UNIQUE REFERENCES registrations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matrix_parent_position_unique UNIQUE(parent_user_id, position)
);
CREATE INDEX matrix_parent_idx ON matrix_placements(parent_user_id);

CREATE TABLE magic_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  registration_id uuid REFERENCES registrations(id),
  distribution_cycle_id uuid,
  direction ledger_direction NOT NULL,
  amount_token_units numeric(78,0) NOT NULL CHECK (amount_token_units > 0),
  reason varchar(80) NOT NULL,
  idempotency_key varchar(160) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_wallet_user_idx ON magic_wallet_ledger(user_id, created_at);

CREATE TABLE direct_income_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id uuid NOT NULL REFERENCES users(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  registration_id uuid NOT NULL REFERENCES registrations(id),
  amount_token_units numeric(78,0) NOT NULL CHECK (amount_token_units > 0),
  tx_hash varchar(66) NOT NULL,
  idempotency_key varchar(160) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direct_income_sponsor_idx ON direct_income_ledger(sponsor_user_id, created_at);

CREATE TABLE distribution_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_cycle_id bigint NOT NULL UNIQUE,
  cycle_date date NOT NULL UNIQUE,
  status distribution_status NOT NULL DEFAULT 'PENDING',
  eligible_users integer NOT NULL DEFAULT 0,
  processed_users integer NOT NULL DEFAULT 0,
  failed_users integer NOT NULL DEFAULT 0,
  tx_hash varchar(66),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE magic_wallet_ledger
  ADD CONSTRAINT magic_wallet_cycle_fk
  FOREIGN KEY (distribution_cycle_id) REFERENCES distribution_cycles(id);

CREATE TABLE magic_income_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_user_id uuid REFERENCES users(id),
  source_user_id uuid NOT NULL REFERENCES users(id),
  distribution_cycle_id uuid NOT NULL REFERENCES distribution_cycles(id),
  matrix_level smallint NOT NULL CHECK (matrix_level BETWEEN 1 AND 20),
  amount_token_units numeric(78,0) NOT NULL CHECK (amount_token_units > 0),
  qualified boolean NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('CLAIMABLE', 'PENDING_UNQUALIFIED', 'PENDING_NO_UPLINE')),
  idempotency_key varchar(160) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distribution_once_per_level UNIQUE(source_user_id, distribution_cycle_id, matrix_level)
);
CREATE INDEX magic_income_beneficiary_idx ON magic_income_ledger(beneficiary_user_id, created_at);

CREATE TABLE indexer_checkpoints (
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  last_block bigint NOT NULL,
  last_block_hash varchar(66),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address)
);

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action varchar(120) NOT NULL,
  target_type varchar(80),
  target_id varchar(160),
  request_id varchar(80) NOT NULL,
  ip_hash varchar(64),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_logs(created_at DESC);
