-- Fixed-column result and one role lookup; removes JSONB roundtrip from management.
BEGIN;
DROP FUNCTION silver.manage(text,text) RESTRICT;
CREATE OR REPLACE FUNCTION silver.manage(p_type text, p_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, email text, role text, galaxy text, anchor text, birthday date, allowed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text := lower(btrim(coalesce(p_type,'')));
  v_id text := lower(btrim(coalesce(p_id,'')));
  v_email text := coalesce(silver.current_auth_email(),'');
  v_allowed boolean;
BEGIN
  IF v_type NOT IN ('self','global','group','scope') THEN
    RAISE EXCEPTION 'Invalid management type' USING ERRCODE='22023';
  END IF;
  IF v_type IN ('group','scope') AND v_id !~ '^[a-z][a-z0-9]{0,14}$' THEN
    RAISE EXCEPTION 'Invalid management id' USING ERRCODE='22023';
  END IF;
  IF v_email='' OR EXISTS (
    SELECT 1 FROM silver.loc l
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(coalesce(l.blacklist->'email','[]'::jsonb)) b(value)
    WHERE l.id='loc' AND lower(b.value->>'email')=v_email
  ) THEN
    IF v_type<>'self' THEN
      RETURN QUERY SELECT v_id,NULL::text,v_type,NULL::text,NULL::text,NULL::date,false;
    END IF;
    RETURN;
  END IF;
  IF v_type='self' THEN
    RETURN QUERY
      SELECT m.id,m.email,m.manage_role::text,m.galaxy_table,m.anchor_table,m.birthday,true
      FROM silver.manage m
      WHERE lower(m.email)=v_email
        AND m.manage_role IN ('admin','group','scope')
        AND (m.manage_role='admin' OR m.active IS TRUE)
      ORDER BY m.id;
    RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM silver.manage m WHERE lower(m.email)=v_email AND (
      (m.id='admin' AND m.manage_role='admin')
      OR (v_type='group' AND m.manage_role='group' AND m.id=v_id AND m.active IS TRUE)
      OR (v_type='scope' AND m.active IS TRUE AND (
        (m.manage_role='scope' AND m.id=v_id)
        OR (v_id='loc' AND m.manage_role='group' AND m.id='loc')
      ))
    )
  ) INTO v_allowed;
  RETURN QUERY SELECT v_id,NULL::text,v_type,NULL::text,NULL::text,NULL::date,v_allowed;
END $function$
;
REVOKE ALL ON FUNCTION silver.manage(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.manage(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION silver.can_manage_global()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT coalesce((SELECT allowed FROM silver.manage('global')),false) $function$
;

CREATE OR REPLACE FUNCTION silver.can_manage_group(p_group_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT coalesce((SELECT allowed FROM silver.manage('group',p_group_id)),false) $function$
;

CREATE OR REPLACE FUNCTION silver.can_manage_scope(p_scope_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT coalesce((SELECT allowed FROM silver.manage('scope',p_scope_id)),false) $function$
;

CREATE OR REPLACE FUNCTION silver.get_my_scope_management()
 RETURNS TABLE(id text, email text, role text, galaxy text, anchor text, birthday date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT m.id,m.email,m.role,m.galaxy,m.anchor,m.birthday FROM silver.manage('self') AS m $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
