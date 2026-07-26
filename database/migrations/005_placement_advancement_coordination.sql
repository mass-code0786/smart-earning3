CREATE TABLE IF NOT EXISTS placement_preparation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL CHECK (chain_id = 97),
  registration_contract varchar(42) NOT NULL,
  sponsor_wallet varchar(42) NOT NULL,
  requested_by_user_wallet varchar(42) NOT NULL,
  request_key varchar(128) NOT NULL UNIQUE,
  status varchar(32) NOT NULL CHECK (status IN (
    'PREPARING','NOT_REQUIRED','SUBMITTED','CONFIRMED','FAILED','TIMED_OUT'
  )),
  error_code varchar(64),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS placement_preparation_scope_idx
  ON placement_preparation_requests(chain_id,registration_contract,sponsor_wallet);
CREATE INDEX IF NOT EXISTS placement_preparation_user_idx
  ON placement_preparation_requests(requested_by_user_wallet,sponsor_wallet,created_at DESC);

CREATE TABLE IF NOT EXISTS placement_advancement_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES placement_preparation_requests(id),
  chain_id integer NOT NULL CHECK (chain_id = 97),
  registration_contract varchar(42) NOT NULL,
  sponsor_wallet varchar(42) NOT NULL,
  keeper_wallet varchar(42) NOT NULL,
  requested_by_user_wallet varchar(42) NOT NULL,
  request_key varchar(160) NOT NULL UNIQUE,
  starting_queue_head numeric(78,0) NOT NULL,
  ending_queue_head numeric(78,0),
  transaction_hash varchar(66),
  transaction_nonce numeric(78,0),
  submitted_block numeric(78,0),
  status varchar(32) NOT NULL CHECK (status IN (
    'PREPARING','SUBMITTING','SUBMITTED','CONFIRMED','FAILED','REPLACED','TIMED_OUT'
  )),
  error_code varchar(64),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transaction_hash)
);

CREATE INDEX IF NOT EXISTS placement_advancement_scope_idx
  ON placement_advancement_attempts(chain_id,registration_contract,sponsor_wallet,created_at DESC);
CREATE INDEX IF NOT EXISTS placement_advancement_status_idx
  ON placement_advancement_attempts(status,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS placement_advancement_active_scope_unique
  ON placement_advancement_attempts(chain_id,registration_contract,sponsor_wallet)
  WHERE status IN ('PREPARING','SUBMITTING','SUBMITTED');

CREATE OR REPLACE FUNCTION reject_placement_attempt_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'placement advancement history is append-only';
END $$;

DROP TRIGGER IF EXISTS placement_attempt_no_delete ON placement_advancement_attempts;
CREATE TRIGGER placement_attempt_no_delete
BEFORE DELETE ON placement_advancement_attempts
FOR EACH ROW EXECUTE FUNCTION reject_placement_attempt_delete();
