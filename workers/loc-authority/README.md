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

**The twelve `public.rainbow_*` tables already exist on Neon, verified by a bounded read-only catalog check on 2026-11-11.** This PR did not create them. All twelve currently have RLS enabled with four permissive CRUD policies restricted to the `rainbow_runtime` PostgreSQL role; that role has LOGIN, public schema USAGE, and CRUD table grants. This establishes the policy/grant configuration, **not** successful Auth Worker connectivity or end-to-end persistence. The exact full model/field
inventory, constraints, indexes, plugin-specific additions, and **each table's
RLS SELECT / INSERT / UPDATE / DELETE policy must be reviewed with the user**
before any production DDL. The above is a code-side naming draft; if a pinned
plugin uses further models, do not create them automatically. Review the
vendor model inventory first.

**Naming invariant:** `loc_auth` is reserved as a non-LOC-Auth identifier:
no LOC Auth table, schema, fallback, or automatic migration may adopt it.
Every LOC Auth-owned table must start with `rainbow_` (including future plugin
models). Existing objects named `loc_auth` belong to a different context and
must not be renamed, imported, adopted, or modified as part of this rewrite.

The verified existing Rainbow PostgreSQL schema is `public`. Auth uses
`public` by default and refuses a conflicting `LOC_AUTH_SCHEMA`; do not
point it at `silver` or recreate tables from an obsolete proposal. `LOC_AUTH_DATABASE_URL` configures the PostgreSQL connection.
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
database Session is not deleted. Privileged LOC Web identity checks use Better Auth's existing signed
Session Cookie Cache rather than disabling it for each operation.
Server-side business permissions remain independently enforced; revoked
sessions may remain valid until the signed Cookie Cache window expires. Keep existing Auth Cloudflare Cache and LOC Web
ISR configurations untouched. Do not reintroduce a Durable Object identity store.

## QoS, simultaneous requests and signing-key safety

The Better Auth general rate limit is presently configured as **120 requests
per 60 seconds**; OAuth Provider uses separate endpoint rules (token: 40,
authorize: 60, introspection: 100, revoke: 30, registration: 5, client-key
rotation: 5, UserInfo: 120, each per 60 seconds). These are draft limits
pending observed traffic and integration testing, not a claim of worldwide
per-client enforcement.

Better Auth 1.7.18's upstream `rateLimit.customRules` now provides
request admission, counters and 429 responses for sensitive Auth endpoints.
The old bespoke in-flight/HTTP admission gate was removed. Its per-source
concurrency ceilings are no longer present; the native limiter instead
enforces per-IP/per-endpoint request-rate budgets. Ordinary Session reads,
public metadata and JWKS never invoke Karaul analysis. The default memory
limiter is shared within an isolate but not globally across Cloudflare PoPs.

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

## LOC Auth native OSS integration (2026-11-13)

The Auth Worker now uses the **published** `@zenstackhq/better-auth@3.10.1`
adapter as its only Better Auth database adapter, via ZenStack v3 and the
existing Kysely PostgreSQL dialect. `rainbow-zmodel.mjs` is a static model
snapshot generated from the 146 existing columns of all twelve
`public.rainbow_*` tables and their unique indexes; no per-request schema
query, runtime migration, RLS changes, or new SQL endpoint is introduced.
The adapter uses `supportsArrays:false` because the existing Rainbow schema
stores OAuth array-valued fields in PostgreSQL JSONB columns, not native
PostgreSQL arrays. Zod is supplied by Better Auth's native request validators,
ZenStack's ORM validators and the existing Auth environment schema; the
previous duplicate handwritten database validation hooks are removed.

Better Auth's **official Admin Plugin** handles Auth users, bans/unbans,
Session revocation, and access control. The Auth administrator role is limited
to user listing/lookup/banning and Session listing/revocation/deletion;
it has no role escalation, impersonation, or user-deletion capability. These
Auth roles do not grant LOC Web business privileges. The five Admin fields
(`role`, `banned`, `banReason`, `banExpires`, `impersonatedBy`) already
exist on the two core Rainbow tables; the RLS policies are unchanged.

Karaul's published `detectChangepoints(series, new PoissonCost())`
provides a bounded 5-second time-series signal for sensitive OAuth/login
endpoints. Only completed buckets with substantial traffic invoke PELT.
On a sustained shift, Better Auth's native `rateLimit.customRules` selects
a stricter 30-second request-rate budget; Better Auth itself counts and
sends HTTP 429. Recovery is based on the next request and elapsed window.
There are no intervals, timers, SQL polls, new stores or separate HTTP
blacklist/enforcement loops. This is **per Worker isolate**, never a global
IP blacklist or a permanent user ban. Account bans and Session revocation
remain entirely inside the native Better Auth Admin Plugin. Public JWKS
is explicitly exempt from the native rate limiter, as it was from the
retired admission gate.

Upstream source references: Better Auth 1.7.18
`packages/better-auth/src/api/rate-limiter/index.ts`; its
`docs/content/docs/concepts/rate-limit.mdx`; Stratal
`packages/framework/src/auth/rate-limit-bridge.ts` (native-rule
integration pattern); Karaul `src/pelt.ts` and `src/costs/poisson.ts`.
No Stratal framework dependency or alternative identity store was added.

The existing 30-minute signed Session Cookie Cache is unchanged for ordinary
SSO traffic. Database Session revocation is authoritative when a request
bypasses that cache or when the cached session expires. A previously issued
JWT without an online liveness check remains subject to its normal TTL; this
Auth-only change does not alter any MCP or website relying-party verifier.

**Release evidence:** Package and schema mappings are committed. Actual Auth
Worker deployment, live OAuth/Session regression, and production performance
are separately verifiable release conditions; do not interpret a Pages build
or a GitHub merge as proof of those behaviors.
