-- Transitional trigger: keeps older deployed clients safe until all readers
-- and writers have switched to the physical columns. The final migration
-- removes the able dependency from this function.
CREATE OR REPLACE FUNCTION silver.normalize_galaxy_content_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.statics:=NEW.statics AND COALESCE((NEW.able->>'statics')::boolean,true);
    NEW.culture:=NEW.culture AND COALESCE((NEW.able->>'culture')::boolean,true);
    NEW.search:=NEW.search AND COALESCE((NEW.able->>'search')::boolean,true);
    NEW.trace:=NEW.trace AND COALESCE((NEW.able->>'trace')::boolean,true);
    NEW."list":=NEW."list" AND COALESCE((NEW.able->>'list')::boolean,true);
    NEW.keyword:=NEW.keyword AND COALESCE((NEW.able->>'keywords')::boolean,true);
    NEW.others:=NEW.others AND COALESCE((NEW.able->>'game')::boolean,true);
    NEW.extract:=NEW.extract AND COALESCE((NEW.able->>'extract')::boolean,true);
  ELSIF NEW.able IS DISTINCT FROM OLD.able THEN
    NEW.statics:=COALESCE((NEW.able->>'statics')::boolean,NEW.statics);
    NEW.culture:=COALESCE((NEW.able->>'culture')::boolean,NEW.culture);
    NEW.search:=COALESCE((NEW.able->>'search')::boolean,NEW.search);
    NEW.trace:=COALESCE((NEW.able->>'trace')::boolean,NEW.trace);
    NEW."list":=COALESCE((NEW.able->>'list')::boolean,NEW."list");
    NEW.keyword:=COALESCE((NEW.able->>'keywords')::boolean,NEW.keyword);
    NEW.others:=COALESCE((NEW.able->>'game')::boolean,NEW.others);
    NEW.extract:=COALESCE((NEW.able->>'extract')::boolean,NEW.extract);
  END IF;
  IF NEW.content IS NULL OR btrim(NEW.content)='' THEN
    NEW.content:=NULL;
    NEW.search:=false;
    NEW."list":=false;
    NEW.able:=COALESCE(NEW.able,'{}'::jsonb)||'{"search":false,"list":false}'::jsonb;
  END IF;
  IF lower(btrim(COALESCE(NEW.site,'')))='mcp' THEN
    NEW."list":=false;
    NEW.able:=COALESCE(NEW.able,'{}'::jsonb)||'{"list":false}'::jsonb;
  END IF;
  RETURN NEW;
END;
$function$;
