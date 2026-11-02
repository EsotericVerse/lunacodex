-- One blacklist read and one management table query per request.
CREATE OR REPLACE FUNCTION silver.manage(p_type text, p_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text := lower(btrim(coalesce(p_type,'')));
  v_id text := lower(btrim(coalesce(p_id,'')));
  v_email text := coalesce(silver.current_auth_email(),'');
  v_rows jsonb;
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
    RETURN CASE WHEN v_type='self' THEN '[]'::jsonb ELSE 'false'::jsonb END;
  END IF;
  IF v_type='self' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'email',m.email,'role',m.manage_role,
      'galaxy',m.galaxy_table,'anchor',m.anchor_table,'birthday',m.birthday
    ) ORDER BY m.id),'[]'::jsonb)
    INTO v_rows
    FROM silver.manage m
    WHERE lower(m.email)=v_email
      AND m.manage_role IN ('admin','group','scope')
      AND (m.manage_role='admin' OR m.active IS TRUE);
    RETURN v_rows;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM silver.manage m
    WHERE lower(m.email)=v_email AND (
      (m.id='admin' AND m.manage_role='admin')
      OR (v_type='group' AND m.manage_role='group' AND m.id=v_id AND m.active IS TRUE)
      OR (v_type='scope' AND m.active IS TRUE AND (
        (m.manage_role='scope' AND m.id=v_id)
        OR (v_id='loc' AND m.manage_role='group' AND m.id='loc')
      ))
    )
  ) INTO v_allowed;
  RETURN to_jsonb(v_allowed);
END $function$
;
REVOKE ALL ON FUNCTION silver.manage(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.manage(text,text) TO authenticated;
