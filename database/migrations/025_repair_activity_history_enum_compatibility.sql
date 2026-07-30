-- include-migration:022_activity_history.sql
-- Recreates the canonical activity-history function and triggers so enum-backed
-- ledger directions are formatted as text. Source and financial rows are not
-- inserted, updated, or deleted.
INSERT INTO schema_migrations(filename)
VALUES('025_repair_activity_history_enum_compatibility.sql')
ON CONFLICT(filename) DO NOTHING;
