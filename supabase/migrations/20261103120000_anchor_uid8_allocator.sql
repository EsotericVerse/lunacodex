BEGIN;
CREATE OR REPLACE FUNCTION silver.new_keyword_tree_uid(p_scope text)
 RETURNS character varying
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_scope text:=lower(btrim(coalesce(p_scope,'')));
 v_anchor regclass;v_candidate varchar(8);v_exists boolean;v_tries int;
 v_alphabet constant text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
BEGIN
 IF v_scope !~ '^[a-z][a-z0-9]{0,14}$'
 OR NOT EXISTS(SELECT 1 FROM silver.manage WHERE id=v_scope AND manage_role='scope' AND active)
 THEN RAISE EXCEPTION 'Invalid Scope'; END IF;
 v_anchor:=to_regclass(format('silver.%I_anchor',v_scope));
 IF v_anchor IS NULL THEN RAISE EXCEPTION 'Scope Anchor not found'; END IF;
 FOR v_tries IN 1..120 LOOP
  SELECT string_agg(substr(v_alphabet,1+floor(random()*62)::integer,1),'' ORDER BY position)::varchar(8)
  INTO v_candidate FROM generate_series(1,8) n(position);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE uid=$1)',v_anchor)
  INTO v_exists USING v_candidate;
  IF NOT v_exists THEN RETURN v_candidate; END IF;
 END LOOP;
 RAISE EXCEPTION 'Cannot allocate unique Anchor UID';
END $function$
;
COMMIT;
