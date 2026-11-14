-- Optional, independently activated public metadata cache revisions.
-- Prerequisite: install loc-sql-result-revisions.pg.sql against the actual
-- selected PostgreSQL database. No public metadata cache is enabled by this
-- DDL; the Pages runtime additionally requires LOC_SQL_RESULT_CACHE_METADATA=1.
--
-- Install only after reviewing current write/import load: a statement trigger
-- adds a revision-row UPDATE for every SQL INSERT/UPDATE/DELETE/TRUNCATE on the
-- covered relation. Other writers are intentionally covered. No Auth tables,
-- api.manage permission entries or private Personal tables are involved.
-- Re-run after adding/recreating a Scope table. Never restore loc_blocks.
-- Reinstall also rotates the generation UUID so replaced tables cannot reuse
-- a completed cache entry with a coincidentally matching revision number.
BEGIN;
DO $loc_metadata_install$
DECLARE item record;
BEGIN
  IF pg_catalog.to_regclass('api.loc_sql_result_revision') IS NULL
     OR pg_catalog.to_regprocedure('api.bump_loc_sql_result_revision()') IS NULL
    THEN RAISE EXCEPTION 'Install LOC numeric SQL revision backing first';
  END IF;

  FOR item IN
    SELECT n.nspname AS ns,c.relname AS rel
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='silver' AND c.relkind IN ('r','p')
      AND (
        c.relname IN ('loc','loc_anchor','lo3rwang','lrunes')
        OR (c.relname <> 'loc_blocks'
          AND c.relname ~ '^[a-z][a-z0-9]{0,14}_(blocks|anchor)$')
        OR EXISTS (
          SELECT 1 FROM api.manage AS m
          WHERE m.id=c.relname AND m.manage_role IN ('scope','group')
        )
      )
  LOOP
    -- A trigger reinstall is itself a cache generation change. Reusing an
    -- old version row here could make a replaced relation look unchanged.
    INSERT INTO api.loc_sql_result_revision(relation,revision)
      VALUES (item.ns||'.'||item.rel,0)
      ON CONFLICT (relation) DO UPDATE
        SET revision=api.loc_sql_result_revision.revision+1,
            generation=pg_catalog.gen_random_uuid();
    EXECUTE format('DROP TRIGGER IF EXISTS loc_sql_result_revision ON %I.%I',
      item.ns,item.rel);
    EXECUTE format(
      'CREATE TRIGGER loc_sql_result_revision
        AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I
        FOR EACH STATEMENT EXECUTE FUNCTION api.bump_loc_sql_result_revision()',
      item.ns,item.rel);
  END LOOP;
END
$loc_metadata_install$;
COMMIT;
