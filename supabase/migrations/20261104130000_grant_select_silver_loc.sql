-- silver.loc already has RLS policies for anon (loc_public_select) and
-- authenticated (loc_manager_select, loc_next_admin_update), but the base
-- table-level GRANT was never issued, so every query against this table as
-- anon/authenticated failed with "permission denied for table loc" before
-- RLS even ran. Confirmed by direct reproduction (SET LOCAL ROLE
-- authenticated; SELECT * FROM silver.loc -> 42501 permission denied,
-- 100% reproducible, with Postgres's own hint naming this exact grant).
-- This is what was breaking the portable JS authorization path
-- (loc-authorization.mjs's locPermissions(), which reads silver.loc.blacklist
-- directly via Kysely, running as role authenticated/anon -- not through the
-- old SECURITY DEFINER silver.manage() SQL function, which bypassed this
-- gap by running as the function owner). This is the root cause of
-- "Database request failed" when entering the Home edit-mode entry point.
GRANT SELECT ON silver.loc TO authenticated;
GRANT SELECT ON silver.loc TO anon;

NOTIFY pgrst, 'reload schema';
