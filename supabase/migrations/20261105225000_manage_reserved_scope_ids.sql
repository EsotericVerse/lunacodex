-- System-owned reserved routing names. A reserved manage ID prevents a
-- new Scope/Group from claiming that ID via the existing primary key.
-- "admin" is already occupied by the real Admin role; keep its note there.
-- Existing email blacklist is intentionally not duplicated into the
-- anon-readable manage.email column (there are currently zero entries).
-- No RLS, GRANT or POLICY alterations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $move$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.value->>'id' AS id,e.value->>'note' AS note
    FROM silver.loc l
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.blacklist->'scopeid','[]'::jsonb)) e(value)
    WHERE l.id='loc'
  LOOP
    IF r.id='admin' THEN
      UPDATE silver.manage SET note=r.note
      WHERE id='admin' AND manage_role='admin';
    ELSE
      IF EXISTS(SELECT 1 FROM silver.manage WHERE id=r.id AND manage_role IS DISTINCT FROM 'reserve')
      THEN RAISE EXCEPTION 'Cannot reserve existing route: %',r.id; END IF;
      INSERT INTO silver.manage(id,manage_role,active,sort_order,note)
      VALUES(r.id,'reserve',false,-50,r.note)
      ON CONFLICT(id) DO UPDATE SET note=EXCLUDED.note
      WHERE silver.manage.manage_role='reserve';
    END IF;
  END LOOP;
END $move$;

DO $verify$
DECLARE expected integer; actual integer;
BEGIN
  SELECT jsonb_array_length(coalesce(blacklist->'scopeid','[]'::jsonb)) INTO expected
  FROM silver.loc WHERE id='loc';
  SELECT count(*) INTO actual FROM silver.manage WHERE manage_role='reserve' OR id='admin';
  IF expected<>actual THEN RAISE EXCEPTION 'Reserve row count mismatch: % <> %',expected,actual; END IF;
END $verify$;
COMMIT;
