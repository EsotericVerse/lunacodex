# LOC Auth — Better Auth model

This Worker **is LOC Auth**. It is not Neon Auth, a Neon Auth proxy, a website display handler,
a Kysely SQL gateway, or a handmade OAuth server.

- Issuer: `https://auth.lo3rwang.cc/api/auth`
- Authentication / Google OAuth: `better-auth`, email/password disabled
- OAuth 2.1 and OIDC provider: `@better-auth/oauth-provider`, Authorization Code + PKCE S256, token/refresh revocation, UserInfo and consent
- RSA signing and JWKS: `better-auth/plugins` `jwt`
- Runtime: existing Cloudflare Worker `auth`
- Storage: PostgreSQL via the **built-in Better Auth Kysely dialect** using Neon merely as PostgreSQL
- Auth namespace: `loc_auth`, not Neon-managed `neon_auth`
- Website read/display: independent Cloudflare Pages/Kysely business data
- Authorization: LOC Auth authenticates users and authorizes its own MCP clients independently; website `api.manage` and Scope authorize website business writes separately, and are never required for an Auth user or Session to exist.

## Required bindings

Existing Worker Google bindings may remain: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
The existing long-term `LOC_CONTROL_ENCRYPTION_KEY` may seed Better Auth's secret,
or `BETTER_AUTH_SECRET` may be set instead. These secrets never belong in Git.

**New:** `LOC_AUTH_DATABASE_URL` is a server-side Neon PostgreSQL URI pointing to the intended LOC database, with the required permissions for the `loc_auth` namespace. Do not reuse `neon_auth` tables.

## Database initialization / release gate

The `loc_auth` namespace has **four Better Auth core tables**: `user`, `session`, `account`,
`verification`. OAuth Provider and JWT/JWKS require additional vendor-defined tables.
Use only Better Auth's generated schema: do not handcraft OAuth, Session or JWK tables.
The Neon-managed `neon_auth` schema and website `api.manage` are unrelated.

A server administrator can initialize the isolated LOC Auth schema once with
`LOC_AUTH_APPLY_SCHEMA=1 node scripts/loc-auth-migrate.mjs`, using the trusted
`LOC_AUTH_DATABASE_URL` and Better Auth secret in the server environment. This calls
Better Auth's official `getMigrations` and verifies all four core tables after applying
its complete core/plugin schema. It is **never invoked by an HTTP request** and never
configured through LOC website Settings. No migration falls back to Durable Object.

The production Neon schema and Worker bindings must be verified independently before
release; adding this script does not mean the migration has already been executed.

## Verification

The repo's manual workflow `Verify Better Auth LOC rewrite` performs `npm ci`, syntax
checks, role unit tests, Wrangler dry-run and a disposable PostgreSQL integration test
that persists all four Better Auth core models. Production acceptance is separate:
complete a real Google login, OIDC discovery, JWKS retrieval, authorization-code exchange,
valid owner write to LOC, denied non-owner write, public content read with Auth unavailable,
and an extension/MCP import with acknowledged UID receipts.

**Do not deploy the Worker, merge the draft PR, or claim writes work until all acceptance
checks have passed.** The OAuth Provider's official client registration replaces legacy
`/oauth/register`; clients still needing the retired URL must be updated first.
