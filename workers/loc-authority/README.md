# LOC Auth (Rainbow / Galaxy-Link)

LOC Auth is an independent SSO, OAuth/OIDC, Session and MCP Gateway service.
Better Auth is the implementation module, **not** the product name.

The LOC Web (LunaCodex / Language of Codex Framework) shares source code, not
the Auth user registry. LOC Web owns business tables and `api.manage`. A LOC
Auth user is valid even if no LOC Web user or `api.manage` record exists.
Specific delegated business operations may reference website permissions; this
must not be required for login or Session creation.

## Storage isolation: Rainbow names only

**The old `loc_auth` test objects are not an Auth storage design.** Never
recreate, import, use, or refer to those test records as the production system.
The user has separately removed a temporary test table in Supabase. This
repository must not try to re-create it.

The code's **table-name mappings** (not actual SQL tables) are explicitly:

| Logical model | Proposed PostgreSQL table |
| --- | --- |
| Better Auth user | `rainbow_auth` |
| Better Auth session | `rainbow_session` |
| Better Auth external account | `rainbow_account` |
| Better Auth verification | `rainbow_verification` |
| JWT JWKS | `rainbow_jwks` |
| OAuth client | `rainbow_oauth_client` |
| OAuth resource | `rainbow_oauth_resource` |
| OAuth client-resource link | `rainbow_oauth_client_resource` |
| OAuth refresh token | `rainbow_oauth_refresh_token` |
| OAuth access token | `rainbow_oauth_access_token` |
| OAuth consent | `rainbow_oauth_consent` |
| OAuth client assertion | `rainbow_oauth_client_assertion` |

**No table above has been created by PR #1374.** The exact full model/field
inventory, constraints, indexes, plugin-specific additions, and **each table's
RLS SELECT / INSERT / UPDATE / DELETE policy must be reviewed with the user**
before any production DDL. The above is a code-side naming draft; if a pinned
plugin uses further models, do not create them automatically. Review the
vendor model inventory first.

The approved PostgreSQL schema is configured explicitly by
`LOC_AUTH_SCHEMA` and must not default to a test namespace. For example,
`silver.rainbow_auth` is possible once `silver` and that precise table have
been approved. `LOC_AUTH_DATABASE_URL` configures the PostgreSQL connection.
These are runtime credentials only; never put a schema-owner credential in
the Worker.

**No automatic migrations, ad hoc schema/table creation, implicit RLS grants,
or SQL RPC.** Auth data read/write uses Better Auth's supported PostgreSQL
adapter. LOC Auth can share one Neon project with LOC Web while its tables and
permissions remain separate. The existing Neon's managed Auth tables and LOC
Web business tables are unrelated and must not be modified for this change.

## Cache and deployment

Keep the user's active Auth Cache and LOC Web ISR configurations unchanged.
Session state belongs in PostgreSQL. Session Cookie Cache is short-lived;
deployment-version changes invalidate cached Session values but do not
delete persisted Sessions. Do not reintroduce a Durable Object identity store.

## Release gate

The branch is a **draft**, not production accepted. It must not be deployed
until the specific table models/fields and RLS are approved, the runtime
database/schema bindings are present, verified Auth SQL read/write succeeds,
OAuth/Session/JWKS works, and the MCP delegation path is tested.
Schema creation requires the user's separate explicit approval on every change;
the previously written test migration scripts have been deleted.
