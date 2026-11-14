-- Read-only SQL revision coverage audit. Run only AFTER installing BOTH
-- loc-sql-result-revisions.pg.sql and loc-sql-metadata-revisions.pg.sql.
-- Expected: version_row_present=true and mutation_trigger_enabled=true
-- on every current publicly cacheable Galaxy / Config / Anchor / Blocks table.
-- This does not inspect or change any authentication or personal rows.
WITH monitored AS (
  SELECT c.oid,n.nspname,c.relname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='silver' AND c.relkind IN ('r','p')
    AND (
      c.relname IN ('loc','lo3rwang','lrunes')
      OR (c.relname ~ '^[a-z][a-z0-9]{0,14}_(galaxy|anchor|blocks)$'
        AND c.relname<>'loc_blocks')
      OR EXISTS (
        SELECT 1 FROM api.manage m
        WHERE m.id=c.relname AND m.manage_role IN ('scope','group')
      )
    )
)
SELECT m.nspname||'.'||m.relname AS relation,
  rev.revision,
  rev.generation,
  rev.relation IS NOT NULL AND rev.generation IS NOT NULL AS version_row_present,
  trg.oid IS NOT NULL
    AND trg.tgenabled IN ('O','A')
    AND trg.tgfoid='api.bump_loc_sql_result_revision()'::regprocedure
    AND (trg.tgtype::integer & 1)=0
    AND (trg.tgtype::integer & 60)=60 AS mutation_trigger_enabled
FROM monitored m
LEFT JOIN api.loc_sql_result_revision rev
  ON rev.relation=m.nspname||'.'||m.relname
LEFT JOIN pg_catalog.pg_trigger trg
  ON trg.tgrelid=m.oid AND trg.tgname='loc_sql_result_revision'
ORDER BY relation;
