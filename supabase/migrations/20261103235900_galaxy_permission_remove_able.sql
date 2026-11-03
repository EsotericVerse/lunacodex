-- Final cutover, to be applied ONLY AFTER the updated LOC/Authority/Edge
-- code is deployed and verified against the physical boolean columns.
-- Scope config silver.lo3rwang.able is NOT a Galaxy article column.
BEGIN;

CREATE OR REPLACE FUNCTION silver.normalize_galaxy_content_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.content IS NULL OR btrim(NEW.content)='' THEN
    NEW.content:=NULL;
    NEW.search:=false;
    NEW."list":=false;
  END IF;
  -- MCP conversations are private even when a writer omits permission fields.
  IF lower(btrim(COALESCE(NEW.site,'')))='mcp' THEN
    NEW.search:=false;
    NEW."list":=false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER lo3rwang_galaxy_content_validity ON silver.lo3rwang_galaxy;
CREATE TRIGGER lo3rwang_galaxy_content_validity
  BEFORE INSERT OR UPDATE OF content,search,"list",site ON silver.lo3rwang_galaxy
  FOR EACH ROW EXECUTE FUNCTION silver.normalize_galaxy_content_validity();
DROP TRIGGER lrunes_galaxy_content_validity ON silver.lrunes_galaxy;
CREATE TRIGGER lrunes_galaxy_content_validity
  BEFORE INSERT OR UPDATE OF content,search,"list",site ON silver.lrunes_galaxy
  FOR EACH ROW EXECUTE FUNCTION silver.normalize_galaxy_content_validity();

-- Preserve every existing management authorization and site restriction:
-- only replace the obsolete JSONB search predicate inside the SELECT RLS policies.
DO $do$
DECLARE item record;
DECLARE old_predicate text:='((able ->> ''search''::text))::boolean IS TRUE';
DECLARE replacement text;
BEGIN
  FOR item IN
    SELECT schemaname,tablename,policyname,qual FROM pg_policies
    WHERE schemaname='silver' AND tablename IN ('lo3rwang_galaxy','lrunes_galaxy')
      AND cmd='SELECT'
  LOOP
    IF position(old_predicate IN item.qual)=0 THEN
      RAISE EXCEPTION 'Cannot safely update Galaxy RLS: %',item.policyname;
    END IF;
    replacement:=replace(item.qual,old_predicate,'search IS TRUE');
    EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
      item.policyname,item.schemaname,item.tablename,replacement);
  END LOOP;
END;
$do$;

ALTER TABLE silver.lo3rwang_galaxy DROP COLUMN able;
ALTER TABLE silver.lrunes_galaxy DROP COLUMN able;

NOTIFY pgrst, 'reload schema';
COMMIT;
