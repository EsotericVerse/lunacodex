-- Galaxy publication/capabilities are eight native Boolean columns.
-- This migration removes ONLY Galaxy.attr and its compatibility sync layer.
-- Anchor.attr is the canonical Anchor payload and is never touched.
DO $guard$
DECLARE scope_name text; cols integer; dependencies integer;
BEGIN
  FOREACH scope_name IN ARRAY ARRAY['lo3rwang','lrunes'] LOOP
    SELECT count(*) INTO cols FROM information_schema.columns
    WHERE table_schema='silver' AND table_name=scope_name||'_galaxy'
      AND column_name IN ('statics','culture','search','trace','list','keyword','extract','others');
    IF cols<>8 THEN RAISE EXCEPTION 'Cannot drop %.attr: expected eight Boolean columns, found %',scope_name,cols; END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='silver'
        AND table_name=scope_name||'_galaxy'
        AND column_name IN ('statics','culture','search','trace','list','keyword','extract','others')
        AND data_type<>'boolean'
    ) THEN RAISE EXCEPTION 'Non-Boolean permission column in %',scope_name; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='silver'
        AND tablename=scope_name||'_galaxy' AND qual ILIKE '%attr%'
    ) THEN RAISE EXCEPTION 'RLS still references Galaxy attr in %',scope_name; END IF;
  END LOOP;
END $guard$;

DROP TRIGGER IF EXISTS zz_galaxy_capability_attr ON silver.lo3rwang_galaxy;
DROP TRIGGER IF EXISTS zz_galaxy_capability_attr ON silver.lrunes_galaxy;
DROP FUNCTION IF EXISTS silver.sync_galaxy_capability_attr() RESTRICT;

ALTER TABLE silver.lo3rwang_galaxy DROP COLUMN IF EXISTS attr RESTRICT;
ALTER TABLE silver.lrunes_galaxy DROP COLUMN IF EXISTS attr RESTRICT;
NOTIFY pgrst, 'reload schema';
