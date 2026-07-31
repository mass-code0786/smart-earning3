ALTER TABLE matrix_placements
  ADD COLUMN IF NOT EXISTS sponsor_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS transaction_hash varchar(66),
  ADD COLUMN IF NOT EXISTS block_number bigint,
  ADD COLUMN IF NOT EXISTS log_index integer;

CREATE UNIQUE INDEX IF NOT EXISTS matrix_placements_chain_event_unique
  ON matrix_placements(transaction_hash,log_index)
  WHERE transaction_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS registration_projection_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  transaction_hash varchar(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  conflict_type varchar(80) NOT NULL,
  expected jsonb NOT NULL,
  actual jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT registration_projection_conflicts_event_unique
    UNIQUE(chain_id,transaction_hash,log_index,conflict_type)
);
