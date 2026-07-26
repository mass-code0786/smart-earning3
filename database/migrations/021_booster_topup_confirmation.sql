ALTER TABLE booster_top_up_history
  ADD COLUMN IF NOT EXISTS source_reference varchar(66),
  ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS treasury_address varchar(42),
  ADD COLUMN IF NOT EXISTS treasury_amount_token_units numeric(78,0);

ALTER TABLE booster_top_up_history
  DROP CONSTRAINT IF EXISTS booster_top_up_history_status_check;
ALTER TABLE booster_top_up_history
  ADD CONSTRAINT booster_top_up_history_status_check
  CHECK(status IN('CONFIRMED'));

ALTER TABLE booster_top_up_history
  DROP CONSTRAINT IF EXISTS booster_top_up_history_treasury_amount_check;
ALTER TABLE booster_top_up_history
  ADD CONSTRAINT booster_top_up_history_treasury_amount_check
  CHECK(treasury_amount_token_units IS NULL OR treasury_amount_token_units=amount_token_units);

CREATE UNIQUE INDEX IF NOT EXISTS booster_top_up_source_reference_uidx
  ON booster_top_up_history(source_reference)
  WHERE source_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS booster_top_up_status_created_idx
  ON booster_top_up_history(status,created_at DESC);
