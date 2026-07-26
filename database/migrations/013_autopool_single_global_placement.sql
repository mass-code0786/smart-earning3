DO $$
BEGIN
  IF EXISTS (
    SELECT placed_entry_id FROM autopool_positions
    GROUP BY placed_entry_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing Autopool data contains entries placed more than once; preserve and reconcile history before applying the global uniqueness constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='autopool_positions'::regclass
      AND contype='u'
      AND pg_get_constraintdef(oid)='UNIQUE (placed_entry_id)'
  ) THEN
    ALTER TABLE autopool_positions
      ADD CONSTRAINT autopool_positions_placed_entry_unique UNIQUE(placed_entry_id);
  END IF;
END
$$;
