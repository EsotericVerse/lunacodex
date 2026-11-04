-- Galaxy publication gate uses attr.search; retain existing ownership and site restrictions.
-- Safe only after the two databases have fully backfilled attr (verified 2026-11-04).
DO $migration$
DECLARE
  pol record;
  next_predicate text;
  replaced integer:=0;
BEGIN
  FOR pol IN
    SELECT schemaname,tablename,policyname,qual
    FROM pg_policies WHERE schemaname='silver'
      AND tablename IN ('lo3rwang_galaxy','lrunes_galaxy')
      AND policyname IN (
        'lo3rwang_galaxy_authenticated_read','lo3rwang_galaxy_public_read',
        'lrunes_galaxy_authenticated_read','lrunes_galaxy_public_read'
      )
  LOOP
    IF pol.qual LIKE '%attr%search%' THEN CONTINUE; END IF;
    IF pol.qual NOT LIKE '%search IS TRUE%' THEN
      RAISE EXCEPTION 'Unexpected RLS definition for %.%',pol.tablename,pol.policyname;
    END IF;
    next_predicate:=replace(pol.qual,'search IS TRUE', '(attr->>''search'')::boolean IS TRUE');
    next_predicate:=replace(next_predicate,'search IS NOT FALSE', '(attr->>''search'')::boolean IS NOT FALSE');
    EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
      pol.policyname,pol.schemaname,pol.tablename,next_predicate);
    replaced:=replaced+1;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='silver'
     AND tablename IN ('lo3rwang_galaxy','lrunes_galaxy')
     AND policyname IN ('lo3rwang_galaxy_authenticated_read','lo3rwang_galaxy_public_read',
                        'lrunes_galaxy_authenticated_read','lrunes_galaxy_public_read')
     AND qual LIKE '%attr%search%')<>4 THEN
     RAISE EXCEPTION 'Not all four Galaxy RLS policies use attr.search';
  END IF;
END $migration$;