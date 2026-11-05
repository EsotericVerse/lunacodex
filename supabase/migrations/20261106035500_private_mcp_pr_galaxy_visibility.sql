-- Fail closed for MCP conversations and GitHub PR-origin entries.
-- The eight Galaxy flags are independent physical booleans, not JSONB.
-- Retain public non-PR GitHub artifacts and existing Scope manager reads.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "statics" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "culture" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "search" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "trace" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "list" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "keyword" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "extract" SET DEFAULT false;
ALTER TABLE silver.lo3rwang_galaxy ALTER COLUMN "others" SET DEFAULT false;
UPDATE silver.lo3rwang_galaxy SET
  "statics"=false,
  "culture"=false,
  "search"=false,
  "trace"=false,
  "list"=false,
  "keyword"=false,
  "extract"=false,
  "others"=false
WHERE (lower(coalesce(site,''))='mcp' OR (lower(coalesce(site,''))='github' AND (coalesce(site_id,'') ~ '^EsotericVerse/moon-runes-pwa#[0-9]+$' OR coalesce(title,'') ~* 'PR[[:space:]]*#[0-9]+')))
  AND ("statics" IS DISTINCT FROM false OR "culture" IS DISTINCT FROM false OR "search" IS DISTINCT FROM false OR "trace" IS DISTINCT FROM false OR "list" IS DISTINCT FROM false OR "keyword" IS DISTINCT FROM false OR "extract" IS DISTINCT FROM false OR "others" IS DISTINCT FROM false);

DO $policy_lo3rwang$
DECLARE rec record; expr text;
BEGIN
  FOR rec IN SELECT policyname,qual FROM pg_policies
    WHERE schemaname='silver' AND tablename='lo3rwang_galaxy'
      AND policyname IN ('lo3rwang_galaxy_public_read','lo3rwang_galaxy_authenticated_read')
  LOOP
    IF rec.qual IS NULL THEN RAISE EXCEPTION 'Missing Galaxy read policy predicate'; END IF;
    expr := '('||rec.qual||') AND (NOT '||$priv$(lower(coalesce(site,''))='mcp' OR (lower(coalesce(site,''))='github' AND (coalesce(site_id,'') ~ '^EsotericVerse/moon-runes-pwa#[0-9]+$' OR coalesce(title,'') ~* 'PR[[:space:]]*#[0-9]+')))$priv$||
      CASE WHEN rec.policyname='lo3rwang_galaxy_authenticated_read' THEN
        ' OR coalesce((select allowed from silver.manage(''scope'',''lo3rwang'')),false)'
      ELSE '' END ||')';
    EXECUTE format('ALTER POLICY %I ON silver.%I USING (%s)',
      rec.policyname,'lo3rwang_galaxy',expr);
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='silver'
    AND tablename='lo3rwang_galaxy' AND policyname IN
    ('lo3rwang_galaxy_public_read','lo3rwang_galaxy_authenticated_read'))<>2
  THEN RAISE EXCEPTION 'Galaxy read policies missing for lo3rwang'; END IF;
END $policy_lo3rwang$;

ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "statics" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "culture" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "search" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "trace" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "list" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "keyword" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "extract" SET DEFAULT false;
ALTER TABLE silver.lrunes_galaxy ALTER COLUMN "others" SET DEFAULT false;
UPDATE silver.lrunes_galaxy SET
  "statics"=false,
  "culture"=false,
  "search"=false,
  "trace"=false,
  "list"=false,
  "keyword"=false,
  "extract"=false,
  "others"=false
WHERE (lower(coalesce(site,''))='mcp' OR (lower(coalesce(site,''))='github' AND (coalesce(site_id,'') ~ '^EsotericVerse/moon-runes-pwa#[0-9]+$' OR coalesce(title,'') ~* 'PR[[:space:]]*#[0-9]+')))
  AND ("statics" IS DISTINCT FROM false OR "culture" IS DISTINCT FROM false OR "search" IS DISTINCT FROM false OR "trace" IS DISTINCT FROM false OR "list" IS DISTINCT FROM false OR "keyword" IS DISTINCT FROM false OR "extract" IS DISTINCT FROM false OR "others" IS DISTINCT FROM false);

DO $policy_lrunes$
DECLARE rec record; expr text;
BEGIN
  FOR rec IN SELECT policyname,qual FROM pg_policies
    WHERE schemaname='silver' AND tablename='lrunes_galaxy'
      AND policyname IN ('lrunes_galaxy_public_read','lrunes_galaxy_authenticated_read')
  LOOP
    IF rec.qual IS NULL THEN RAISE EXCEPTION 'Missing Galaxy read policy predicate'; END IF;
    expr := '('||rec.qual||') AND (NOT '||$priv$(lower(coalesce(site,''))='mcp' OR (lower(coalesce(site,''))='github' AND (coalesce(site_id,'') ~ '^EsotericVerse/moon-runes-pwa#[0-9]+$' OR coalesce(title,'') ~* 'PR[[:space:]]*#[0-9]+')))$priv$||
      CASE WHEN rec.policyname='lrunes_galaxy_authenticated_read' THEN
        ' OR coalesce((select allowed from silver.manage(''scope'',''lrunes'')),false)'
      ELSE '' END ||')';
    EXECUTE format('ALTER POLICY %I ON silver.%I USING (%s)',
      rec.policyname,'lrunes_galaxy',expr);
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='silver'
    AND tablename='lrunes_galaxy' AND policyname IN
    ('lrunes_galaxy_public_read','lrunes_galaxy_authenticated_read'))<>2
  THEN RAISE EXCEPTION 'Galaxy read policies missing for lrunes'; END IF;
END $policy_lrunes$;

COMMIT;
