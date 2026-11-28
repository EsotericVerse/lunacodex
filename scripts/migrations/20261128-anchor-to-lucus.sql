-- LOC-only physical rename. Review the target database before running this
-- transaction. Deploy the Lucus build only after this migration succeeds.
-- This script is intentionally manual; application startup never runs DDL.
BEGIN;

DO $migration$
DECLARE
  registry_row record;
  old_table text;
  new_table text;
  old_exists boolean;
  new_exists boolean;
  lucus_column_exists boolean;
BEGIN
  IF to_regclass('api.manage') IS NULL THEN
    RAISE EXCEPTION 'api.manage is missing; cannot migrate LOC table configuration';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='api' AND table_name='manage' AND column_name='lucus_table'
  ) INTO lucus_column_exists;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='api' AND table_name='manage' AND column_name='anchor_table'
  ) THEN
    IF lucus_column_exists THEN
      RAISE EXCEPTION 'api.manage has both anchor_table and lucus_table; refusing an ambiguous migration';
    END IF;
    FOR registry_row IN
      EXECUTE 'SELECT id, COALESCE(NULLIF(btrim(anchor_table), ''''), ''anchor'') AS old_suffix, active FROM api.manage'
    LOOP
      IF registry_row.id !~ '^[a-z][a-z0-9]{0,14}$' OR
         registry_row.old_suffix !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'Invalid api.manage table mapping for scope %', registry_row.id;
      END IF;
      old_table := registry_row.id || '_' || registry_row.old_suffix;
      new_table := registry_row.id || '_lucus';
      IF old_table = new_table THEN
        CONTINUE;
      END IF;
      old_exists := to_regclass(format('%I.%I','silver',old_table)) IS NOT NULL;
      new_exists := to_regclass(format('%I.%I','silver',new_table)) IS NOT NULL;
      IF old_exists AND new_exists THEN
        RAISE EXCEPTION 'Both silver.% and silver.% exist; refusing a lossy rename', old_table, new_table;
      ELSIF old_exists THEN
        EXECUTE format('ALTER TABLE %I.%I RENAME TO %I','silver',old_table,new_table);
      ELSIF NOT new_exists AND registry_row.active IS TRUE AND registry_row.id <> 'admin' THEN
        RAISE EXCEPTION 'Neither silver.% nor silver.% exists for active scope %', old_table, new_table, registry_row.id;
      END IF;
    END LOOP;

    ALTER TABLE api.manage RENAME COLUMN anchor_table TO lucus_table;
  ELSIF NOT lucus_column_exists THEN
    RAISE EXCEPTION 'api.manage has neither anchor_table nor lucus_table';
  END IF;

  UPDATE api.manage SET lucus_table='lucus';
  ALTER TABLE api.manage ALTER COLUMN lucus_table SET DEFAULT 'lucus';
END
$migration$;

COMMIT;

-- Confirm the deployed mapping after the transaction:
-- SELECT id, galaxy_table, lucus_table FROM api.manage ORDER BY id;
