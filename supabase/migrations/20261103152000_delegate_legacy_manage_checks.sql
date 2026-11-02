-- Existing legacy entry points delegate to the canonical permission function.
-- Keep old signatures for RLS and existing import callers; no nested permission RPC calls.
CREATE OR REPLACE FUNCTION silver.can_manage_global()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$ SELECT (silver.manage('global'))::text::boolean $f$;

CREATE OR REPLACE FUNCTION silver.can_manage_group(p_group_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$ SELECT (silver.manage('group',p_group_id))::text::boolean $f$;

CREATE OR REPLACE FUNCTION silver.can_manage_scope(p_scope_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$ SELECT (silver.manage('scope',p_scope_id))::text::boolean $f$;

CREATE OR REPLACE FUNCTION silver.get_my_scope_management()
RETURNS TABLE(id text,email text,role text,galaxy text,anchor text,birthday date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
 SELECT j.id,j.email,j.role,j.galaxy,j.anchor,j.birthday
 FROM pg_catalog.jsonb_to_recordset(silver.manage('self'))
 AS j(id text,email text,role text,galaxy text,anchor text,birthday date)
$f$;
