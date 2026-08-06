-- UserRegistered.matrixIndex restarts for each contract deployment.
-- bfs_index remains the globally unique legacy database ordering key.
CREATE SEQUENCE IF NOT EXISTS matrix_placements_bfs_index_seq AS bigint;

SELECT setval(
  'matrix_placements_bfs_index_seq',
  GREATEST(COALESCE((SELECT max(bfs_index) FROM matrix_placements),0)+1,1),
  false
);

ALTER TABLE matrix_placements
  ALTER COLUMN bfs_index SET DEFAULT nextval('matrix_placements_bfs_index_seq'),
  ADD COLUMN IF NOT EXISTS contract_address varchar(42),
  ADD COLUMN IF NOT EXISTS contract_matrix_index numeric(78,0);

UPDATE matrix_placements placement
SET contract_address=lower(transaction_row.to_address),
    contract_matrix_index=placement.bfs_index
FROM registrations registration
JOIN blockchain_transactions transaction_row
  ON lower(transaction_row.tx_hash)=lower(registration.tx_hash)
 AND transaction_row.event_name='UserRegistered'
WHERE placement.registration_id=registration.id
  AND placement.contract_address IS NULL
  AND transaction_row.to_address IS NOT NULL;

ALTER TABLE matrix_placements
  DROP CONSTRAINT IF EXISTS matrix_placements_contract_address_lower,
  DROP CONSTRAINT IF EXISTS matrix_placements_contract_index_nonnegative;

ALTER TABLE matrix_placements
  ADD CONSTRAINT matrix_placements_contract_address_lower
    CHECK(contract_address IS NULL OR contract_address=lower(contract_address)),
  ADD CONSTRAINT matrix_placements_contract_index_nonnegative
    CHECK(contract_matrix_index IS NULL OR contract_matrix_index>=0);

CREATE UNIQUE INDEX IF NOT EXISTS matrix_placements_contract_index_unique
  ON matrix_placements(contract_address,contract_matrix_index)
  WHERE contract_address IS NOT NULL AND contract_matrix_index IS NOT NULL;
