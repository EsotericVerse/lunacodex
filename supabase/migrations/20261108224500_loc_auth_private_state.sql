-- LOC Auth private state, independent from publicly readable api.manage.
-- Only digests of bearer/refresh/session secrets may appear in state_key.
CREATE TABLE IF NOT EXISTS api.loc_auth (
    bucket VARCHAR(64) NOT NULL,
    state_key VARCHAR(320) NOT NULL,
    value_json TEXT NOT NULL,
    expires_at BIGINT,
    updated_at BIGINT NOT NULL,
    revision VARCHAR(36) NOT NULL,
    CONSTRAINT loc_auth_pkey PRIMARY KEY (bucket, state_key)
);
CREATE INDEX IF NOT EXISTS loc_auth_expiry_idx
    ON api.loc_auth (expires_at) WHERE expires_at IS NOT NULL;

REVOKE ALL PRIVILEGES ON TABLE api.loc_auth FROM PUBLIC, anon, anonymous, authenticated;
GRANT USAGE ON SCHEMA api TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE api.loc_auth TO service_role;

-- api.manage remains publicly SELECT-able. RLS is not an auth substitute.
