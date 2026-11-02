BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
CREATE OR REPLACE FUNCTION silver.read_scope_keyword_suggestions(p_scope_id text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope_id,'')));v_cols boolean;v_rows text[];
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
 OR NOT silver.can_manage_scope(v_scope)
 THEN RAISE EXCEPTION 'Scope permission denied' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
 WHERE attrelid=pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope))
 AND attname='keyword_suggestions' AND attnum>0 AND NOT attisdropped) INTO v_cols;
 IF NOT v_cols THEN RETURN ARRAY[]::text[]; END IF;
 EXECUTE pg_catalog.format('SELECT keyword_suggestions FROM silver.%I WHERE id=$1',v_scope)
 INTO v_rows USING v_scope;
 RETURN coalesce(v_rows,ARRAY[]::text[]);
END $function$
;
CREATE OR REPLACE FUNCTION silver.read_scope_search_summary(p_scope_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope text;v_snapshot jsonb;v_rows jsonb:='[]'::jsonb;
BEGIN
 IF p_scope_ids IS NULL OR cardinality(p_scope_ids)>100
 OR EXISTS(SELECT 1 FROM unnest(p_scope_ids) AS u(id) WHERE id !~ '^[a-z][a-z0-9]{0,14}$')
 THEN RAISE EXCEPTION 'Invalid requested Scopes' USING ERRCODE='22023'; END IF;
 FOR v_scope IN SELECT DISTINCT m.id FROM silver.manage m
   WHERE m.id=ANY(p_scope_ids) AND m.manage_role='scope' AND m.active IS TRUE ORDER BY m.id
 LOOP
  IF pg_catalog.to_regclass(pg_catalog.format('silver.%I',v_scope)) IS NULL THEN CONTINUE; END IF;
  EXECUTE pg_catalog.format('SELECT status->''search'' FROM silver.%I WHERE id=$1',v_scope)
    INTO v_snapshot USING v_scope;
  IF pg_catalog.jsonb_typeof(v_snapshot)='object' THEN
   v_rows:=v_rows||pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('scope_id',v_scope,'article_count',v_snapshot->'article_count',
    'word_count',v_snapshot->'word_count','first_date',v_snapshot->'first_date',
    'last_date',v_snapshot->'last_date','refreshed_at',v_snapshot->'refreshed_at'));
  END IF;
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('rows',v_rows);
END $function$
;
COMMIT;