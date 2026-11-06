-- Existing Galaxy/Anchor table schema, RLS, indexes, and attr remain unchanged.
-- Retire read-only SQL RPCs after the website switched to direct Kysely actions.
-- Audited 2026-11-06: zero pg_depend NORMAL dependents, zero SQL callers
-- outside this retirement group, zero deployed loc-kysely SQL call sites.
-- Public action names such as read_app_bootstrap remain valid in Kysely.
-- Do not remove security helpers (silver.manage, api.current_user_id, triggers).
-- RESTRICT prevents deletion of unexpected catalog-dependent objects.

DROP FUNCTION IF EXISTS silver.read_scope_analytics(text,text,date,date,jsonb) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_loc_statistics(date,date) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_overview(text,date,date) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_keyword_tree_summary(text,date,date,text,text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_trace_keyword_group_totals(text,text[],date,date,text,text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_trace_place_density(text,text[],date,date,text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_place_statistics(text,date,date) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_category_totals(text,date,date) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_search_summary(text[]) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_statistics(text,date,date,boolean) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_earliest(text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_shared_keyword_classes(text) RESTRICT;
DROP FUNCTION IF EXISTS silver.scope_keyword_catalog(text,text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_scope_page_copy(text) RESTRICT;
DROP FUNCTION IF EXISTS silver.read_app_bootstrap(text,text) RESTRICT;
DROP FUNCTION IF EXISTS silver.search_scope_trace_place_names(text,text,integer) RESTRICT;
