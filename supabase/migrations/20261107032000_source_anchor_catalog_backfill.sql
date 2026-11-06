-- One-time, additive source-catalog backfill from the currently active
-- legacy per-Scope lists. This never changes Galaxy.site or site_id,
-- and it does not delete or overwrite ArticleTag/txt_class.
-- The physical source nodes live in each existing *_anchor table.
BEGIN;
DO $$
DECLARE
  r record;
  relation_name text;
  source_column text;
  source_list jsonb;
  source_label text;
  source_site text;
  from_uid varchar(8);
  domain_uid varchar(8);
  child_uids jsonb;
  seen_sites jsonb;
  node_exists boolean;
  attempts integer;
  old_nodes integer;
BEGIN
  FOR r IN
    SELECT id,coalesce(nullif(anchor_table,''),'anchor') AS anchor_suffix
    FROM api.manage
    WHERE id IN ('lo3rwang','lrunes') AND manage_role='scope' AND active=true
    ORDER BY id
  LOOP
    IF r.id !~ '^[a-z][a-z0-9]{0,14}$'
       OR r.anchor_suffix !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid Source Scope Anchor mapping';
    END IF;
    relation_name:=format('silver.%I',r.id||'_'||r.anchor_suffix);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'Source Scope Anchor not found: %',relation_name;
    END IF;
    source_column:=CASE WHEN r.id='lrunes' THEN 'txt_class' ELSE 'ArticleTag' END;
    EXECUTE format('SELECT to_jsonb(%I) FROM silver.%I WHERE id=$1',
      source_column,r.id) INTO source_list USING r.id;
    IF source_list IS NULL OR jsonb_typeof(source_list)<>'array' THEN
      RAISE EXCEPTION 'Legacy Source list is missing for %',r.id;
    END IF;
    EXECUTE format('SELECT count(*) FROM %s WHERE type IN (''domain'',''from'')',
      relation_name) INTO old_nodes;
    IF old_nodes<>0 THEN
      RAISE EXCEPTION 'Source Anchor already exists for %, refusing to overwrite',r.id;
    END IF;
    child_uids:='[]'::jsonb;
    seen_sites:='{}'::jsonb;
    FOR source_label IN SELECT btrim(value) FROM jsonb_array_elements_text(source_list) AS v(value)
    LOOP
      IF source_label='' OR length(source_label)>80 THEN
        RAISE EXCEPTION 'Invalid Source label for %',r.id;
      END IF;
      -- Same legacy Source-label suffix rule as sourceSiteKeyForLabel():
      -- 方格子vocus -> vocus; 無名wretch -> wretch; 其他 -> others.
      source_site:=CASE WHEN source_label='其他' THEN 'others'
        ELSE coalesce(nullif(substring(lower(source_label) from
           '([a-z][a-z0-9_-]{2,})$'),''),lower(source_label)) END;
      IF seen_sites ? source_site THEN
        RAISE EXCEPTION 'Duplicate normalized Source key for %: %',r.id,source_site;
      END IF;
      seen_sites:=seen_sites||jsonb_build_object(source_site,true);
      node_exists:=true;attempts:=0;
      WHILE node_exists AND attempts<128 LOOP
        attempts:=attempts+1;
        from_uid:=left(replace(gen_random_uuid()::text,'-',''),8);
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE uid=$1)',relation_name)
          INTO node_exists USING from_uid;
      END LOOP;
      IF node_exists THEN RAISE EXCEPTION 'Cannot allocate From UID'; END IF;
      EXECUTE format('INSERT INTO %s
        (uid,type,title,description,invisible,attr)
        VALUES ($1,''from'',$2,$3,false,''{}''::jsonb)',relation_name)
        USING from_uid,source_site,
          CASE WHEN source_label=source_site THEN NULL ELSE source_label END;
      child_uids:=child_uids||jsonb_build_array(from_uid);
    END LOOP;
    node_exists:=true;attempts:=0;
    WHILE node_exists AND attempts<128 LOOP
      attempts:=attempts+1;
      domain_uid:=left(replace(gen_random_uuid()::text,'-',''),8);
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE uid=$1)',relation_name)
        INTO node_exists USING domain_uid;
    END LOOP;
    IF node_exists THEN RAISE EXCEPTION 'Cannot allocate Domain UID'; END IF;
    EXECUTE format('INSERT INTO %s
      (uid,type,title,description,invisible,attr)
      VALUES ($1,''domain'',$2,null,false,$3)',relation_name)
      USING domain_uid,r.id,jsonb_build_object('uid',child_uids);
  END LOOP;
END;
$$;
COMMIT;
