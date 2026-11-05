-- Allow new Routing rows to be created without duplicating Group names.
-- The legacy display_name column is retained temporarily for old code/RPCs.
-- No RLS/GRANT/POLICY change.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE silver.manage ALTER COLUMN display_name DROP NOT NULL;
COMMIT;
