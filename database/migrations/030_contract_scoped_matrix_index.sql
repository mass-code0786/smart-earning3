-- UserRegistered.matrixIndex restarts for each contract deployment.
-- bfs_index remains the globally unique legacy database ordering key.
CREATE SEQUENCE IF NOT EXISTS matrix_placements_bfs_index_seq AS bigint;

SELECT setval(
  'matrix_placements_bfs_index_seq',
  GREATEST(
    COALESCE((SELECT max(bfs_index) FROM matrix_placements),0)+1,
    (SELECT CASE WHEN is_called THEN last_value+1 ELSE last_value END
     FROM matrix_placements_bfs_index_seq),
    1
  ),
  false
);

ALTER TABLE matrix_placements
  ALTER COLUMN bfs_index SET DEFAULT nextval('matrix_placements_bfs_index_seq'),
  ADD COLUMN IF NOT EXISTS contract_address varchar(42),
  ADD COLUMN IF NOT EXISTS contract_matrix_index numeric(78,0);

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='matrix_placements'::regclass
      AND conname='matrix_placements_contract_address_lower') THEN
    ALTER TABLE matrix_placements ADD CONSTRAINT matrix_placements_contract_address_lower
      CHECK(contract_address IS NULL OR contract_address=lower(contract_address));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='matrix_placements'::regclass
      AND conname='matrix_placements_contract_index_nonnegative') THEN
    ALTER TABLE matrix_placements ADD CONSTRAINT matrix_placements_contract_index_nonnegative
      CHECK(contract_matrix_index IS NULL OR contract_matrix_index>=0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS matrix_placements_contract_index_unique
  ON matrix_placements(contract_address,contract_matrix_index)
  WHERE contract_address IS NOT NULL AND contract_matrix_index IS NOT NULL;
