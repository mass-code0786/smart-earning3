CREATE TABLE blockchain_indexer_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  last_processed_block bigint NOT NULL CHECK (last_processed_block >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blockchain_indexer_state_chain_contract_unique
    UNIQUE(chain_id, contract_address)
);

CREATE TABLE blockchain_processed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL,
  contract_address varchar(42) NOT NULL,
  transaction_hash varchar(66) NOT NULL,
  log_index integer NOT NULL CHECK (log_index >= 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  event_name varchar(120) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blockchain_processed_events_identity_unique
    UNIQUE(chain_id, transaction_hash, log_index)
);

CREATE INDEX blockchain_processed_events_contract_block_idx
  ON blockchain_processed_events(chain_id, contract_address, block_number);
