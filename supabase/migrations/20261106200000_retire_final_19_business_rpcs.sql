-- Retire only SQL business RPCs already implemented by direct Kysely actions.
-- Verified against live pg_proc + pg_depend and both updated Edge bundles:
--   no external SQL function callers, no NORMAL object dependencies,
--   no deployed direct calls to silver.new_keyword_tree_uid(text).
-- Keep api.manage and authorization, RLS, constraint and trigger functions.
-- This does NOT modify tables, columns, indexes, attr, policies or grants.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

-- Old SQL-only wrappers must be removed before their delegate functions.
DROP FUNCTION silver.manage_scope_registry(text,text,jsonb) RESTRICT;
DROP FUNCTION api.manage_scope_registry(text,text,jsonb) RESTRICT;
DROP FUNCTION silver.management_write(text,text,jsonb,jsonb,jsonb) RESTRICT;
DROP FUNCTION api.management_write(text,text,jsonb,jsonb,jsonb) RESTRICT;

-- Old shared-keyword importer and its SQL UID helper.
DROP FUNCTION silver.import_shared_keyword_class(text,text,text) RESTRICT;
DROP FUNCTION silver.keyword_class_is_shared(text,text) RESTRICT;
DROP FUNCTION silver.new_keyword_tree_uid(text) RESTRICT;

-- The remaining SQL business endpoints are already direct Kysely actions.
DROP FUNCTION silver.batch_fill_galaxy_location(text,text[],text,boolean,integer) RESTRICT;
DROP FUNCTION silver.is_current_email_blocklisted() RESTRICT;
DROP FUNCTION silver.loc_admin_settings(text,text,text,jsonb) RESTRICT;
DROP FUNCTION silver.manage_id_not_blocked() RESTRICT;
DROP FUNCTION silver.merge_scope_trace_place_names(text,character varying,character varying[]) RESTRICT;
DROP FUNCTION silver.preview_or_fill_galaxy_place(text,date,date,text,boolean,integer) RESTRICT;
DROP FUNCTION silver.read_group_members(text) RESTRICT;
DROP FUNCTION silver.read_scope_registry_admin() RESTRICT;
DROP FUNCTION silver.refresh_scope_search_summary(text) RESTRICT;
DROP FUNCTION silver.save_scope_trace_place_names(text,character varying,text[]) RESTRICT;
DROP FUNCTION silver.update_group_default_article_class(text,text[]) RESTRICT;
DROP FUNCTION silver.update_group_member_name(text,text,text) RESTRICT;
COMMIT;
