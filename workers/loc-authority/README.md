# LOC Auth (Rainbow / Galaxy-Link)

LOC Auth is an independent SSO, OAuth/OIDC, Session and MCP Gateway service.
Better Auth is the implementation module, **not** the product name.

The LOC Web (LunaCodex / Language of Codex Framework) shares source code, not
the Auth user registry. LOC Web owns business tables and `api.manage`. A LOC
Auth user is valid even if no LOC Web user or `api.manage` record exists.
The two systems have independent identity, Session and business-authorization
stores, but they are **not unrelated**. They may reference each other through
explicit, narrowly scoped, verified contracts (for example Auth identity ->
LOC Web `api.manage` when authorizing a website business write, or a website
resource -> an Auth-issued MCP delegation). Such references never silently
merge records, make one table authoritative for the other, or require a LOC Web
record before an Auth identity/Session can exist. Auth-owned persistence and
MCP Gateway control-plane writes must work independently of `api.manage`.

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
permissions remain separate. Existing Neon-managed Auth tables and LOC Web business tables remain distinct
and may be referenced through explicitly verified integration contracts; neither
becomes LOC Auth's own persistence store. Do not modify those existing tables
for this change.

## Cache and deployment

Keep the user's active Auth Cache and LOC Web ISR configurations unchanged.
Session state belongs in PostgreSQL. Signed Session Cookie Cache is
**30 minutes**, not a 30-minute polling timer. A new Worker version changes
the cache version; old cached values then stop being used, but the persisted
database Session is not deleted. Privileged LOC Web identity checks use
`get-session?disableCookieCache=true` so Session revocation is not silently
delayed by the Cookie Cache. Keep existing Auth Cloudflare Cache and LOC Web
ISR configurations untouched. Do not reintroduce a Durable Object identity store.

## QoS, simultaneous requests and signing-key safety

The Better Auth general rate limit is presently configured as **120 requests
per 60 seconds**; OAuth Provider uses separate endpoint rules (token: 40,
authorize: 60, introspection: 100, revoke: 30, registration: 5, client-key
rotation: 5, UserInfo: 120, each per 60 seconds). These are draft limits
pending observed traffic and integration testing, not a claim of worldwide
per-client enforcement.

A new **transport admission gate** counts in-flight Auth requests, not
physical TCP/TLS sockets or PostgreSQL connections. Within each Worker isolate
it uses a 128-request total ceiling and separate per-source ceilings:
OAuth 24, Session 48, public metadata/JWKS 96, other 32. On overload it
returns HTTP 429 with Retry-After: 2, and releases the slot after every
completed request. A normal 30-minute Session Cache hit is not a new SQL
query by definition.

**A Worker isolate's memory counters are NOT global across Cloudflare
instances, not a permanent blacklist, and not an authorization decision.**
Do not claim that changing IP, OAuth client, or Worker instance is blocked.
Globally consistent abuse enforcement and owner-triggered blacklist or
client/Session revocation require a separately approved shared policy/control
mechanism and end-to-end tests. Do not silently introduce SQL tables, RPC,
RLS policies or a new Auth identity store to implement it.

**High request concurrency never invalidates the entire issuer JWKS.** Such
invalidations would disrupt unrelated valid clients. Better Auth manages
normal JWKS key rotation (currently 30-day rotation with 30-day previous-key
grace). A confirmed credential/key compromise calls for the affected
credential or key to be revoked, and any active token security review must
account for already-issued stateless JWT validity. Connection storms instead
receive backpressure / QoS limits, not global signing-key destruction.

## Release gate

The branch is a **draft**, not production accepted. It must not be deployed
until the specific table models/fields and RLS are approved, the runtime
database/schema bindings are present, verified Auth SQL read/write succeeds,
OAuth/Session/JWKS works, and the MCP delegation path is tested.
Schema creation requires the user's separate explicit approval on every change;
the previously written test migration scripts have been deleted.
