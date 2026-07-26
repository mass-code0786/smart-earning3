DO $$
BEGIN
  IF EXISTS (
    SELECT parent_user_id
    FROM matrix_placements
    WHERE parent_user_id IS NOT NULL
    GROUP BY parent_user_id
    HAVING count(*) > 2
  ) THEN
    RAISE EXCEPTION
      'Matrix correction blocked: at least one parent has more than two children';
  END IF;

  IF EXISTS (
    SELECT parent_user_id,position
    FROM matrix_placements
    WHERE parent_user_id IS NOT NULL
    GROUP BY parent_user_id,position
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Matrix correction blocked: duplicate global parent position detected';
  END IF;
END;
$$;

ALTER TABLE matrix_placements
  DROP CONSTRAINT IF EXISTS matrix_tree_parent_position_unique;

ALTER TABLE matrix_placements
  DROP CONSTRAINT IF EXISTS matrix_tree_bfs_index_unique;

DROP INDEX IF EXISTS matrix_tree_sponsor_idx;

ALTER TABLE matrix_placements
  DROP COLUMN IF EXISTS tree_sponsor_user_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='matrix_parent_position_unique'
  ) THEN
    ALTER TABLE matrix_placements
      ADD CONSTRAINT matrix_parent_position_unique
      UNIQUE(parent_user_id,position);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='matrix_placements_bfs_index_key'
  ) THEN
    ALTER TABLE matrix_placements
      ADD CONSTRAINT matrix_placements_bfs_index_key
      UNIQUE(bfs_index);
  END IF;
END;
$$;
