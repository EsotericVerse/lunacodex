-- Atomic merge for the unified spatial anchors. No legacy _trace relation is used.
-- Source point UIDs disappear only after every dependent reference is rewritten.
CREATE OR REPLACE FUNCTION silver.replace_point_uid_links(
  p_value jsonb, p_from text[], p_to text
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, silver
AS $fn$
DECLARE item jsonb; entry record; changed jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(p_value)
    WHEN 'string' THEN
      IF (p_value #>> '{}') = ANY(p_from) THEN RETURN to_jsonb(p_to); END IF;
      RETURN p_value;
    WHEN 'array' THEN
      changed := '[]'::jsonb;
      FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
        changed := changed || jsonb_build_array(silver.replace_point_uid_links(item,p_from,p_to));
      END LOOP;
      RETURN changed;
    WHEN 'object' THEN
      changed := '{}'::jsonb;
      FOR entry IN SELECT key,value FROM jsonb_each(p_value) LOOP
        changed := changed || jsonb_build_object(entry.key,
          silver.replace_point_uid_links(entry.value,p_from,p_to));
      END LOOP;
      RETURN changed;
    ELSE RETURN p_value;
  END CASE;
END
$fn$;

CREATE OR REPLACE FUNCTION silver.merge_scope_anchor_points(
  p_scope_id text, p_keep_uid varchar, p_remove_uids varchar[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, silver
AS $fn$
DECLARE
  v_from text[];
  v_count integer;
  v_names jsonb;
  v_name_list text[];
BEGIN
  -- This Scope has completed the four-table cutover; do not route to _trace.
  IF p_scope_id <> 'lo3rwang' OR NOT silver.can_manage_scope(p_scope_id) THEN
    RAISE EXCEPTION '無權合併此 Scope 的空間定錨';
  END IF;
  IF p_keep_uid IS NULL OR p_keep_uid !~ '^[A-Za-z0-9]{8}$'
    OR p_remove_uids IS NULL OR cardinality(p_remove_uids) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION '地點 UID 清單無效'; END IF;
  SELECT array_agg(uid::text) INTO v_from FROM unnest(p_remove_uids) AS uid;
  IF EXISTS (SELECT 1 FROM unnest(v_from) AS uid
    WHERE uid IS NULL OR uid !~ '^[A-Za-z0-9]{8}$' OR uid=p_keep_uid)
    OR (SELECT count(DISTINCT uid) FROM unnest(v_from) AS uid) <> cardinality(v_from)
  THEN RAISE EXCEPTION '不可合併主要地點或重複地點'; END IF;

  -- Serialize mergers, then lock all explicitly selected rows in UID order.
  PERFORM pg_advisory_xact_lock(hashtextextended('anchor-point-merge:lo3rwang',0));
  PERFORM uid FROM silver.lo3rwang_anchor
   WHERE type='point' AND (uid=p_keep_uid OR uid=ANY(v_from))
   ORDER BY uid FOR UPDATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(v_from)+1 THEN
    RAISE EXCEPTION '地點已變更或不屬於此 Scope，請重新讀取';
  END IF;

  -- Retain original spelling, previously confirmed aliases and address labels.
  WITH place_names AS (
    SELECT a.title AS name FROM silver.lo3rwang_anchor a
      WHERE a.type='point' AND (a.uid=p_keep_uid OR a.uid=ANY(v_from))
    UNION ALL
    SELECT jsonb_array_elements_text(
      CASE jsonb_typeof(a.attr->'location')
        WHEN 'array' THEN a.attr->'location'
        WHEN 'string' THEN jsonb_build_array(a.attr->'location')
        ELSE '[]'::jsonb END)
      FROM silver.lo3rwang_anchor a
      WHERE a.type='point' AND (a.uid=p_keep_uid OR a.uid=ANY(v_from))
    UNION ALL
    SELECT unnest(p.name_lists) FROM silver.lo3rwang_place p
      WHERE p.uid=p_keep_uid OR p.uid=ANY(v_from)
  ), names AS (
    SELECT DISTINCT btrim(name) AS name FROM place_names
    WHERE nullif(btrim(name),'') IS NOT NULL AND char_length(btrim(name))<=320
  )
  SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb),
         coalesce(array_agg(name ORDER BY name),'{}'::text[])
    INTO v_names,v_name_list FROM names;

  -- Both point references and article assignments must move before deletion.
  UPDATE silver.lo3rwang_galaxy
    SET place_id=p_keep_uid WHERE place_id=ANY(v_from);
  UPDATE silver.lo3rwang_anchor a
    SET attr=jsonb_set(coalesce(a.attr,'{}'::jsonb),'{point}',
      silver.replace_point_uid_links(a.attr->'point',v_from,p_keep_uid::text),true)
    WHERE a.type IN ('path','trace') AND a.attr ? 'point'
      AND EXISTS (SELECT 1 FROM unnest(v_from) old_uid
        WHERE (a.attr->'point')::text LIKE '%"'||old_uid||'"%');

  -- A path with fewer than two distinct endpoints must not be silently corrupted.
  IF EXISTS (
    SELECT 1 FROM silver.lo3rwang_anchor a WHERE a.type='path'
    AND jsonb_typeof(a.attr->'point')='array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(a.attr->'point') e
      WHERE jsonb_typeof(e) <> 'string'
    )=false
    AND (SELECT count(DISTINCT e.value) FROM jsonb_array_elements_text(a.attr->'point') e)
      <> (SELECT count(*) FROM jsonb_array_elements(a.attr->'point'))
  ) THEN
    RAISE EXCEPTION '合併後路線會重複使用同一地點，請先整理路線';
  END IF;

  UPDATE silver.lo3rwang_anchor SET
    attr=jsonb_set(coalesce(attr,'{}'::jsonb),'{location}',v_names,true)
    WHERE uid=p_keep_uid AND type='point';
  -- Keep the existing alias reader working until the importer moves to attr.
  INSERT INTO silver.lo3rwang_place(uid,name_lists)
    VALUES(p_keep_uid,v_name_list)
  ON CONFLICT(uid) DO UPDATE SET
    name_lists=excluded.name_lists,updated_at=now();

  DELETE FROM silver.lo3rwang_anchor
    WHERE type='point' AND uid=ANY(v_from);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>cardinality(v_from) THEN
    RAISE EXCEPTION '地點合併數量不一致，已取消整次交易';
  END IF;
  DELETE FROM silver.lo3rwang_place WHERE uid=ANY(v_from);
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION silver.merge_scope_anchor_points(text,varchar,varchar[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silver.merge_scope_anchor_points(text,varchar,varchar[]) TO authenticated,service_role;
