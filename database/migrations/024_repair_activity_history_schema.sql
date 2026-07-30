-- include-migration:022_activity_history.sql
-- Replays the canonical, idempotent activity-history DDL. The migration runner
-- expands the include inside this migration's transaction. Existing history
-- rows are preserved; triggers are replaced, and no source/financial rows are
-- inserted, updated, or deleted.
INSERT INTO schema_migrations(filename)
VALUES('024_repair_activity_history_schema.sql')
ON CONFLICT(filename) DO NOTHING;
