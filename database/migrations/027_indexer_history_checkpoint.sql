ALTER TABLE blockchain_indexer_state
  ADD COLUMN IF NOT EXISTS history_start_block bigint
  CHECK (history_start_block IS NULL OR history_start_block >= 0);
