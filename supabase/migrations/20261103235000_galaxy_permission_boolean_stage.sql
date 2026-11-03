-- Stage 1: normalize existing Galaxy permission columns before the code cutover.
-- Scope-level silver.lo3rwang.able is unrelated and must not be changed.
ALTER TABLE silver.lrunes_galaxy
  ADD COLUMN IF NOT EXISTS statics boolean,
  ADD COLUMN IF NOT EXISTS culture boolean,
  ADD COLUMN IF NOT EXISTS search boolean,
  ADD COLUMN IF NOT EXISTS trace boolean,
  ADD COLUMN IF NOT EXISTS "list" boolean,
  ADD COLUMN IF NOT EXISTS keyword boolean,
  ADD COLUMN IF NOT EXISTS others boolean,
  ADD COLUMN IF NOT EXISTS extract boolean;

-- Direct boolean fields are authoritative; fill only missing values.
-- The retired JSON keys keywords/game correspond to keyword/others.
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['lo3rwang_galaxy','lrunes_galaxy'] LOOP
    EXECUTE format($q$
      UPDATE silver.%I SET
        statics=coalesce(statics,(able->>'statics')::boolean,true),
        culture=coalesce(culture,(able->>'culture')::boolean,true),
        search=coalesce(search,(able->>'search')::boolean,true),
        trace=coalesce(trace,(able->>'trace')::boolean,true),
        "list"=coalesce("list",(able->>'list')::boolean,true),
        keyword=coalesce(keyword,(able->>'keyword')::boolean,(able->>'keywords')::boolean,true),
        others=coalesce(others,(able->>'others')::boolean,(able->>'game')::boolean,true),
        extract=coalesce(extract,(able->>'extract')::boolean,true)
      WHERE statics IS NULL OR culture IS NULL OR search IS NULL OR trace IS NULL
         OR "list" IS NULL OR keyword IS NULL OR others IS NULL OR extract IS NULL
    $q$,name);
  END LOOP;
END $$;

ALTER TABLE silver.lo3rwang_galaxy
  ALTER COLUMN statics SET DEFAULT true,
  ALTER COLUMN culture SET DEFAULT true,
  ALTER COLUMN search SET DEFAULT true,
  ALTER COLUMN trace SET DEFAULT true,
  ALTER COLUMN "list" SET DEFAULT true,
  ALTER COLUMN keyword SET DEFAULT true,
  ALTER COLUMN others SET DEFAULT true,
  ALTER COLUMN extract SET DEFAULT true;
ALTER TABLE silver.lrunes_galaxy
  ALTER COLUMN statics SET DEFAULT true,
  ALTER COLUMN culture SET DEFAULT true,
  ALTER COLUMN search SET DEFAULT true,
  ALTER COLUMN trace SET DEFAULT true,
  ALTER COLUMN "list" SET DEFAULT true,
  ALTER COLUMN keyword SET DEFAULT true,
  ALTER COLUMN others SET DEFAULT true,
  ALTER COLUMN extract SET DEFAULT true;

-- Do not DROP able here: remove it only after all clients/SQL routines have
-- switched and a deployed production smoke test has passed.
