-- LOC Galaxy eight capability flags: canonical attr JSONB.
-- Non-destructive compatibility stage: physical boolean columns remain while
-- older SQL/RPC/clients are migrated. No additional indexes or tables.
-- Apply to Supabase and Neon with identical DDL before enabling attr readers.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE silver.lo3rwang_galaxy
  ADD COLUMN IF NOT EXISTS attr jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE silver.lrunes_galaxy
  ADD COLUMN IF NOT EXISTS attr jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION silver.sync_galaxy_capability_attr()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  incoming jsonb;
BEGIN
  IF NEW.attr IS NULL THEN NEW.attr := '{}'::jsonb; END IF;
  IF pg_catalog.jsonb_typeof(NEW.attr) <> 'object' THEN
    RAISE EXCEPTION 'Galaxy.attr must be a JSON object' USING ERRCODE='22023';
  END IF;
  -- An explicit attr edit wins. Legacy boolean edits still write through.
  IF (TG_OP='INSERT' AND NEW.attr <> '{}'::jsonb)
     OR (TG_OP='UPDATE' AND NEW.attr IS DISTINCT FROM OLD.attr) THEN
    incoming := NEW.attr;
    NEW.statics := COALESCE((incoming->>'statics')::boolean,NEW.statics);
    NEW.culture := COALESCE((incoming->>'culture')::boolean,NEW.culture);
    NEW.search := COALESCE((incoming->>'search')::boolean,NEW.search);
    NEW.trace := COALESCE((incoming->>'trace')::boolean,NEW.trace);
    NEW."list" := COALESCE((incoming->>'list')::boolean,NEW."list");
    NEW.keyword := COALESCE((incoming->>'keyword')::boolean,NEW.keyword);
    NEW.extract := COALESCE((incoming->>'extract')::boolean,NEW.extract);
    NEW.others := COALESCE((incoming->>'others')::boolean,NEW.others);
  END IF;
  -- Preserve existing public-search/MCP invariants in either write path.
  IF NEW.content IS NULL OR pg_catalog.btrim(NEW.content)='' THEN
    NEW.search := false;
    NEW."list" := false;
  END IF;
  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.site,'')))='mcp' THEN
    NEW."list" := false;
  END IF;
  NEW.attr := pg_catalog.jsonb_build_object(
    'statics',NEW.statics,'culture',NEW.culture,'search',NEW.search,
    'trace',NEW.trace,'list',NEW."list",'keyword',NEW.keyword,
    'extract',NEW.extract,'others',NEW.others
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_galaxy_capability_attr ON silver.lo3rwang_galaxy;
DROP TRIGGER IF EXISTS zz_galaxy_capability_attr ON silver.lrunes_galaxy;
CREATE TRIGGER zz_galaxy_capability_attr
  BEFORE INSERT OR UPDATE OF attr,statics,culture,search,trace,"list",keyword,extract,others,content,site
  ON silver.lo3rwang_galaxy FOR EACH ROW
  EXECUTE FUNCTION silver.sync_galaxy_capability_attr();
CREATE TRIGGER zz_galaxy_capability_attr
  BEFORE INSERT OR UPDATE OF attr,statics,culture,search,trace,"list",keyword,extract,others,content,site
  ON silver.lrunes_galaxy FOR EACH ROW
  EXECUTE FUNCTION silver.sync_galaxy_capability_attr();

-- Preserve each existing row's eight effective booleans. No defaults reset.
UPDATE silver.lo3rwang_galaxy SET attr = pg_catalog.jsonb_build_object(
  'statics',statics,'culture',culture,'search',search,'trace',trace,
  'list',"list",'keyword',keyword,'extract',extract,'others',others
) WHERE attr='{}'::jsonb;
UPDATE silver.lrunes_galaxy SET attr = pg_catalog.jsonb_build_object(
  'statics',statics,'culture',culture,'search',search,'trace',trace,
  'list',"list",'keyword',keyword,'extract',extract,'others',others
) WHERE attr='{}'::jsonb;
COMMIT;
