-- Optional PostgreSQL backing for LOC's fixed anonymous SQL results.
-- Apply ONLY to the actual selected primary DB, NOT an inactive mirror.
-- Never apply during ongoing bulk-import sessions without coordination.
-- Installation is transactional. Trigger bumps share the writer transaction.
-- Re-installing bumps existing epochs to invalidate any prior results.
-- This covers existing Galaxy, Scope Config, Anchor and Blocks relations,
-- but deliberately excludes retired silver.loc_blocks and api.manage grants.
-- Invalidation granularity is one physical relation, not one UID or date.
BEGIN;
CREATE TABLE IF NOT EXISTS api.loc_sql_result_revision (
  relation text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE OR REPLACE FUNCTION api.bump_loc_sql_result_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $loc_revision$
BEGIN
  INSERT INTO api.loc_sql_result_revision(relation,revision)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,1)
  ON CONFLICT (relation) DO UPDATE
    SET revision = api.loc_sql_result_revision.revision + 1;
  RETURN NULL;
END
$loc_revision$;

DO $loc_install$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT n.nspname AS ns,c.relname AS rel
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
    WHERE n.nspname='silver' AND c.relkind IN ('r','p')
      AND (
        c.relname='loc'
        OR (c.relname ~ '^[a-z][a-z0-9]{0,14}_(galaxy|anchor|blocks)$'
          AND c.relname<>'loc_blocks')
        OR c.relname IN (
          SELECT id FROM api.manage
          WHERE id ~ '^[a-z][a-z0-9]{0,14}$'
        )
      )
  LOOP
    INSERT INTO api.loc_sql_result_revision(relation,revision)
      VALUES (item.ns||'.'||item.rel,0)
      ON CONFLICT (relation) DO UPDATE
        SET revision=api.loc_sql_result_revision.revision+1;
    EXECUTE format(
      'DROP TRIGGER IF EXISTS loc_sql_result_revision ON %I.%I',
      item.ns,item.rel);
    EXECUTE format(
      'CREATE TRIGGER loc_sql_result_revision
        AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I
        FOR EACH STATEMENT EXECUTE FUNCTION api.bump_loc_sql_result_revision()',
      item.ns,item.rel);
  END LOOP;
END
$loc_install$;
COMMIT;
