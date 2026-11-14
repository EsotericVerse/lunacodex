-- Read-only verification AFTER running loc-sql-result-revisions.pg.sql.
-- Expected: every published physical Scope relation has both a revision row
-- and an enabled AFTER STATEMENT trigger for all four mutation operations.
-- This audit does not modify DB state or touch Auth/session permissions.
WITH expected AS (
  SELECT c.oid,n.nspname,c.relname
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
  WHERE n.nspname='silver' AND c.relkind IN ('r','p')
    AND (
      c.relname='loc'
      OR (c.relname ~ '^[a-z][a-z0-9]{0,14}_(galaxy|anchor|blocks)$'
        AND c.relname<>'loc_blocks')
      OR c.relname IN (
        SELECT id FROM api.manage WHERE id ~ '^[a-z][a-z0-9]{0,14}$'
      )
    )
)
SELECT e.nspname||'.'||e.relname AS relation,
  v.revision,
  v.relation IS NOT NULL AS version_row_present,
  t.oid IS NOT NULL
    AND t.tgenabled IN ('O','A')
    AND t.tgfoid='api.bump_loc_sql_result_revision()'::regprocedure
    AND (t.tgtype::int & 1)=0
    AND (t.tgtype::int & 60)=60 AS mutation_trigger_enabled
FROM expected AS e
LEFT JOIN api.loc_sql_result_revision AS v
  ON v.relation=e.nspname||'.'||e.relname
LEFT JOIN pg_catalog.pg_trigger AS t
  ON t.tgrelid=e.oid AND t.tgname='loc_sql_result_revision'
ORDER BY relation;
