-- Only an authenticated owner may create or change their own settings.
-- api.loc_user already has RLS INSERT/UPDATE policies bound to api.current_user_id().
-- No user row is created at OAuth login: first actual preference edit inserts.
GRANT INSERT, UPDATE ON TABLE api.loc_user TO authenticated;
