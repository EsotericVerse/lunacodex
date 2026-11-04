-- User-requested bounded diagnostic counter. Preserve existing observations.
-- Do NOT instrument silver.manage() with SQL writes: it is part of RLS hot paths.
-- This migration introduces no query, timer, trigger, index, or permission grant.
ALTER TABLE silver.lo3rwang
  ADD COLUMN IF NOT EXISTS "count" integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='silver.lo3rwang'::regclass
      AND conname='lo3rwang_permission_count_cap'
  ) THEN
    ALTER TABLE silver.lo3rwang
      ADD CONSTRAINT lo3rwang_permission_count_cap
      CHECK ("count" BETWEEN 0 AND 1000);
  END IF;
END $$;

COMMENT ON COLUMN silver.lo3rwang."count" IS
  'Bounded diagnostic observation (0-1000), not a live authorization gate. Do not write from RLS-backed silver.manage().';

-- Restore the exact non-instrumented management predicate used by RLS.
-- The temporary writer was never part of permission semantics. Keeping it
-- in a STABLE function risks read-only SQL failure and multiplies writes.
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
