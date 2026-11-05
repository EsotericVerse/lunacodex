-- LOC live schema / legacy-dependency audit (READ ONLY).
-- Execute against an already authorized PostgreSQL database.
-- Never use this audit as a migration or bootstrap script.
-- No table writes, DDL, or permissions changes.
--
-- 1. Actual user tables and their RLS status.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname IN ('api','silver')
ORDER BY n.nspname,c.relname;

-- 2. Any *actual* old Scope metadata tables still physically present.
SELECT n.nspname AS schema_name, c.relname AS legacy_table
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('api','silver') AND c.relkind IN ('r','p')
  AND (c.relname ~ '_(time|trace|keywords|galaxy_media|place)$'
       OR c.relname IN ('loc_runtime_config','loc_dblists','loc_theme',
         'loc_keywords','email_blocklist','block_scopeid','loc_cache_runtime'))
ORDER BY 1,2;

-- 3. Installed routines with references to retired table names
--    or the retired type+attr dispatcher. These can survive deleting
--    migration files; do not drop until callers and dependent policies are checked.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       CASE
         WHEN p.prosrc ~* '_(time|trace|keywords|galaxy_media|place)\y'
           THEN 'legacy Scope table suffix'
         WHEN p.prosrc ~* '(loc_runtime_config|loc_dblists|loc_theme|loc_keywords|scope_type_attr)'
           THEN 'legacy LOC table / dispatcher'
         ELSE 'inspect'
       END AS finding
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('api','silver') AND p.prokind IN ('f','p')
  AND (p.prosrc ~* '_(time|trace|keywords|galaxy_media|place)\y'
    OR p.prosrc ~* '(loc_runtime_config|loc_dblists|loc_theme|loc_keywords|scope_type_attr)')
ORDER BY 1,2,3;

-- 4. Existing policies on the two active Galaxy tables:
--    verify site=mcp / GitHub PR privacy and manager visibility.
SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check
FROM pg_policies
WHERE schemaname='silver'
  AND tablename IN ('lo3rwang_galaxy','lrunes_galaxy')
ORDER BY tablename,policyname;

-- 5. Actual indexes; avoid resurrecting order-by-uid or obsolete GIN indexes.
SELECT schemaname,tablename,indexname,indexdef
FROM pg_indexes
WHERE schemaname='silver'
  AND tablename IN ('lo3rwang_galaxy','lrunes_galaxy',
                    'lo3rwang_anchor','lrunes_anchor')
ORDER BY tablename,indexname;

-- 6. Galaxy physical permissions and computed date status.
SELECT table_schema,table_name,column_name,data_type,is_generated,generation_expression,
       column_default
FROM information_schema.columns
WHERE table_schema='silver'
  AND table_name IN ('lo3rwang_galaxy','lrunes_galaxy')
  AND column_name IN ('uid','createtime','date','site','site_id',
    'statics','culture','search','trace','list','keyword','extract','others','able','attr')
ORDER BY table_name,ordinal_position;

-- 7. Metadata only: verify which SQL migration versions were recorded as applied.
--    This is informational; it does not imply dropped files were replayed.
SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_history_relation;
