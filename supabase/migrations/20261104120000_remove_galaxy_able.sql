-- Stage after application and MCP deployments. Preserve eight existing boolean
-- columns and eliminate only the obsolete Galaxy.able JSONB dependency.
-- Run as a single transactional migration; RESTRICT prevents accidental cascades.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';

ALTER POLICY "lo3rwang_galaxy_authenticated_read" ON silver."lo3rwang_galaxy" USING ((( SELECT COALESCE(( SELECT manage.allowed
           FROM silver.manage('scope'::text, 'lo3rwang'::text) manage(id, email, role, galaxy, anchor, birthday, allowed)), false) AS can_manage_scope) OR ((search IS TRUE) AND (search IS NOT FALSE) AND (lower(COALESCE(site, ''::text)) <> ALL (ARRAY['messenger'::text, 'chatgpt'::text, 'claude'::text, 'gemini'::text, 'msn'::text, 'whatsapp'::text, 'telegram'::text, 'discord'::text, 'line'::text, 'wechat'::text, 'teams'::text, 'copilot'::text, 'grok'::text, 'perplexity'::text, 'meta ai'::text, 'meta-ai'::text])))));

ALTER POLICY "lo3rwang_galaxy_public_read" ON silver."lo3rwang_galaxy" USING (((search IS TRUE) AND (search IS NOT FALSE) AND (lower(COALESCE(site, ''::text)) <> ALL (ARRAY['messenger'::text, 'chatgpt'::text, 'claude'::text, 'gemini'::text, 'msn'::text, 'whatsapp'::text, 'telegram'::text, 'discord'::text, 'line'::text, 'wechat'::text, 'teams'::text, 'copilot'::text, 'grok'::text, 'perplexity'::text, 'meta ai'::text, 'meta-ai'::text]))));

ALTER POLICY "lrunes_galaxy_authenticated_read" ON silver."lrunes_galaxy" USING ((((search IS TRUE) AND (search IS NOT FALSE)) OR ( SELECT COALESCE(( SELECT manage.allowed
           FROM silver.manage('scope'::text, 'lrunes'::text) manage(id, email, role, galaxy, anchor, birthday, allowed)), false) AS can_manage_scope)));

ALTER POLICY "lrunes_galaxy_public_read" ON silver."lrunes_galaxy" USING (((search IS TRUE) AND (search IS NOT FALSE)));

CREATE OR REPLACE FUNCTION silver.normalize_galaxy_content_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $galaxy_validity$
BEGIN
  IF NEW.content IS NULL OR pg_catalog.btrim(NEW.content)='' THEN
    NEW.content:=NULL;
    NEW.search:=false;
    NEW.list:=false;
  END IF;
  IF pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(NEW.site,'')))='mcp' THEN
    NEW.list:=false;
  END IF;
  RETURN NEW;
END;
$galaxy_validity$;

DROP TRIGGER IF EXISTS lo3rwang_galaxy_content_validity ON silver.lo3rwang_galaxy;
CREATE TRIGGER lo3rwang_galaxy_content_validity
  BEFORE INSERT OR UPDATE OF content, search, list, site
  ON silver.lo3rwang_galaxy FOR EACH ROW
  EXECUTE FUNCTION silver.normalize_galaxy_content_validity();
DROP TRIGGER IF EXISTS lrunes_galaxy_content_validity ON silver.lrunes_galaxy;
CREATE TRIGGER lrunes_galaxy_content_validity
  BEFORE INSERT OR UPDATE OF content, search, list, site
  ON silver.lrunes_galaxy FOR EACH ROW
  EXECUTE FUNCTION silver.normalize_galaxy_content_validity();

-- Other eight boolean flags remain untouched. No CASCADE and no new index/table.
ALTER TABLE silver.lo3rwang_galaxy DROP COLUMN able RESTRICT;
ALTER TABLE silver.lrunes_galaxy DROP COLUMN able RESTRICT;
COMMIT;
