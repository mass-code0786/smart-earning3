-- Registration matrix parent slots restart for each contract deployment.
-- Preserve the legacy NULL-address matrix as one immutable namespace and scope
-- every deployment-aware placement by its confirmed contract address.
ALTER TABLE matrix_placements
  DROP CONSTRAINT IF EXISTS matrix_parent_position_unique;

CREATE UNIQUE INDEX IF NOT EXISTS matrix_placements_legacy_parent_position_unique
  ON matrix_placements(parent_user_id,position)
  WHERE contract_address IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS matrix_placements_contract_parent_position_unique
  ON matrix_placements(contract_address,parent_user_id,position)
  WHERE contract_address IS NOT NULL;
