-- Rename legacy Anchor constraint/index identifiers on the already-migrated
-- LOC Lucus tables. This changes object names only; it does not rebuild tables,
-- copy rows, change index definitions, or alter constraint expressions.
-- Run after 20261128-anchor-to-lucus.sql.

BEGIN;

DO $migration$
DECLARE
  item record;
  new_name text;
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lo3rwang_lucus',
    'loc_lucus',
    'lrunes_lucus'
  ]
  LOOP
    IF to_regclass(format('%I.%I', 'silver', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required Lucus table silver.% is missing', table_name;
    END IF;
  END LOOP;

  -- Rename every constraint whose identifier still carries the old term.
  -- On PostgreSQL 18 this includes named NOT NULL constraints; on older
  -- versions only the supported constraint kinds are present in pg_constraint.
  FOR item IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      c.conname AS object_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'silver'
      AND t.relname IN ('lo3rwang_lucus','loc_lucus','lrunes_lucus')
      AND c.conname ILIKE '%anchor%'
    ORDER BY t.relname, c.conname
  LOOP
    new_name := replace(item.object_name, 'anchor', 'lucus');

    IF EXISTS (
      SELECT 1
      FROM pg_constraint existing
      WHERE existing.conrelid = to_regclass(format('%I.%I', item.schema_name, item.table_name))
        AND existing.conname = new_name
    ) THEN
      RAISE EXCEPTION 'Constraint rename collision on %.%: % -> %',
        item.schema_name, item.table_name, item.object_name, new_name;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
      item.schema_name, item.table_name, item.object_name, new_name
    );
  END LOOP;

  -- Primary-key indexes follow their constraint rename. Rename any remaining
  -- standalone indexes (for example, the type indexes) without changing their
  -- definitions or access methods.
  FOR item IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      i.relname AS object_name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'silver'
      AND t.relname IN ('lo3rwang_lucus','loc_lucus','lrunes_lucus')
      AND i.relname ILIKE '%anchor%'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid
      )
    ORDER BY t.relname, i.relname
  LOOP
    new_name := replace(item.object_name, 'anchor', 'lucus');

    IF to_regclass(format('%I.%I', item.schema_name, new_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'Index rename collision in %: % -> %',
        item.schema_name, item.object_name, new_name;
    END IF;

    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      item.schema_name, item.object_name, new_name
    );
  END LOOP;
END
$migration$;

COMMIT;

-- Verify no legacy object names remain:
-- SELECT conname FROM pg_constraint
-- WHERE conrelid IN ('silver.lo3rwang_lucus'::regclass,
--                    'silver.loc_lucus'::regclass,
--                    'silver.lrunes_lucus'::regclass)
--   AND conname ILIKE '%anchor%';
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname='silver'
--   AND tablename IN ('lo3rwang_lucus','loc_lucus','lrunes_lucus')
--   AND indexname ILIKE '%anchor%';