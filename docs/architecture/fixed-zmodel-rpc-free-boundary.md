# LOC fixed-schema / RPC-free execution boundary

This branch is a **code-only** cutover. There is no SQL migration, table/index
change, RLS or GRANT change, or automatic database introspection at runtime.

## Canonical model

- `zenstack/schema.zmodel` describes the **existing** Supabase `silver`
  physical tables. This is a fixed model, not an instruction to deploy a schema.
- `zenstack/schema-contract.json` is a frozen read-only metadata snapshot of
  the 17 physical tables and their 273 existing columns.
  It also preserves the 96 database-generated/defaulted columns and the
  existing `lrunes_daily(record_date,draw_kind)` UNIQUE constraint.
- `zenstack/schema.mjs` maps that frozen metadata into the publicly documented
  ZenStack V3 `SchemaDef` runtime shape without installing its CLI or invoking
  Prisma. Do not represent this bridge as an official `zen generate` output.
- `zenstack/client.mjs` creates a ZenStack V3 client from a trusted injected
  Kysely dialect for fixed models. No additional connections are opened by
  importing the factory; only instantiate it inside the authorized server
  execution path.
- `npm run test:module-native` includes
  `scripts/test-fixed-zmodel.mjs` for physical-column parity, primary keys,
  Anchor's extension fields, RPC-free active browser transport and ORM/Kysely
  SQL compilation using a no-I/O dialect. These tests must actually run before
  promotion; a static check alone is not a passed runtime test.

## Correct module ownership

- ZenStack V3 is optional for **fixed PostgreSQL models** only after the
  runtime SQL compilation test succeeds. It must not introduce a second SQL
  connection path or replace the LOC delegation boundary at the trusted gateway.
- Kysely is authoritative for dynamic Scope names, SQL dialects (PostgreSQL,
  MySQL, SQL Server, SQLite), bounded queries and transactional writes. The
  existing `loc-kysely` gateway already provides `query`, `analytics`,
  `anchor`, `public-action`, `managed-write` and `managed-action`.
- Five SQL-nullable arrays are intentionally kept on Kysely until a lossless
  representation is verified; ZModel V3 cannot express `String[]?`.
- Postgres RLS remains a database boundary; ZenStack `$qb` and raw SQL do
  **not** enforce ZenStack policy plugin rules.
- New product features reuse `*_anchor.attr`; no physical Schema changes.

## RPC retirement criteria

Treat **business RPCs as unavailable**, not as a fallback. In particular, a
working Kysely action must be confirmed at each active caller before disabling
its old RPC route. Never delete SQL functions by assuming that the presence of
an older migration proves an unused function. Check active server endpoints,
static publishing, client providers, import, management, and local SQLite.

Only remove legacy SQL functions in a final dependency-checked retirement after
Kysely functional parity, authorization, cross-dialect support and aggregate
query budgets are verified. Do not rewrite or delete applied migration history.

## Current scope boundary

The fixed ZModel/SchemaDef and browser/local transport simplifications are
implemented in the work branch; complete application RPC replacement and
end-to-end verification are **not yet claimed**.

## Cross-dialect Galaxy content search

The active website Search provider and device-local SQLite query builder use a shared, bounded AND/OR parser and a parameterized `contains` filter
instead of encoding unrestricted `ILIKE` expressions. The implementation is
at `app/loc/providers/portable-search.mjs` and the trusted
`kysely-runtime.mjs`. SQL `LIKE ... ESCAPE '!'` treats `%`, `_`, and `!`
literally. CJK/case-free terms avoid `LOWER(content)` while mixed Latin terms
retain case-insensitive matching. Quoted `null`, `true` and numeric-looking
terms remain strings. Advanced AND/OR/NOT uses the same operator.

This is a portable SQL semantic improvement, **not** an indexed full-text
search engine. Search QoS/statement timeout and page limits remain active.
No database indexes, tables, columns, Anchor.attr changes or RPC are required.
Existing other `ILIKE` callers remain available pending their independent
feature parity checks.

Query planning on the live PostgreSQL schema was checked using **EXPLAIN
without ANALYZE**, so neither statement was executed. Both the original
LOWER/LIKE and the CJK-native LIKE plan can scan many rows; comparative latency
and all four SQL-dialect runtime results are not yet verified. Do not promise a
guaranteed speedup until measured.


## Business RPC retirement — verified dependencies (2026-11-06)

Read-only `pg_proc` and `pg_depend` inspection of the existing Supabase
`silver` / `api` schemas found more than a dozen legacy analytics and
management functions. A `pg_depend` count of zero **is not sufficient**
to drop PL/pgSQL functions: runtime function bodies can refer to one another
without a catalog dependency.

- The legacy `silver.read_scope_analytics` dispatcher still references
  `read_scope_statistics`, `read_scope_category_totals`,
  `read_scope_earliest`, `read_scope_overview`,
  `read_scope_search_summary`, `read_scope_place_statistics`,
  `read_keyword_tree_summary`, `read_shared_keyword_classes`,
  `read_trace_place_density`, `read_trace_keyword_group_totals`,
  `scope_keyword_catalog`, and `read_loc_statistics`. Retire dispatcher
  first **after active consumers and ISR fallback paths are proved independent**;
  only then retire its former helper functions using `DROP FUNCTION ... RESTRICT`
  with exact PostgreSQL signatures.
- Both Kysely Keyword importers now call the **existing**
  `allocateAnchorUid` eight-character Base62 generator. New Scope provisioning
  copies into its just-created empty Anchor and only reserves new IDs in a local
  `Set`; it does not compare against the database. Existing Scope class import
  writes with `INSERT ... ON CONFLICT (uid) DO NOTHING RETURNING uid` and
  retries only when the primary key reports a collision. No per-UID SELECT,
  full Anchor scan, separate UID RPC, duplicate generator, or advisory lock.
  The previously deployed SQL importer and UID helper have been replaced
  by the mainline Kysely implementation. Both Edge variants now include
  the canonical Base62 allocator and no longer invoke the SQL UID function.

- Public ISR summary and public Bootstrap now use the established
  `analytics` and `publicAction` methods directly. The obsolete `.rpc()`
  fallback and the unused SQL gateway `kind='rpc'` dispatch branch were
  removed. No new conversion layer, schema field, index or JSONB payload.
- Galaxy Culture, Statistics, Earliest and LOC summaries now call one
  bounded Kysely aggregate when ISR is unavailable. Removed missing-RPC
  detection and the large multi-Scope, full-article comparison fallback.
  Optional ISR remains a cache, not an alternate database algorithm.
- Never conflate policy/trigger helper functions with public RPCs:
  `api.current_user_id`, `api.manage`,
  `silver.domain_has_repeated_labels`,
  `silver.sync_scope_config_display_name`, and
  `silver.touch_visual_novel_updated_at` currently have catalog dependents.
  They must not be removed without explicit policy, check constraint or
  trigger rewrites (which are outside this PR).
- `api.management_write` and other `SECURITY DEFINER` management functions
  require separate live caller, role and transaction verification before
  deletion. Lack of a direct import in one client is not proof of no use.

**Retirement status:** the first sixteen read-only SQL functions were removed
by the verified migration `20261106173000_retire_unused_read_business_rpcs.sql`.
The final nineteen business functions are handled by the later migration
`20261106200000_retire_final_19_business_rpcs.sql`. Only the authorized,
RLS/constraint/trigger-related helpers remain after the second migration.


## SQL read-only RPC retirement batch (2026-11-06)

`supabase/migrations/20261106173000_retire_unused_read_business_rpcs.sql`
retires sixteen SQL `silver` functions replaced by native Kysely
`analytics` and `publicAction` implementations. Live `pg_proc` and
`pg_depend` metadata confirmed every target has zero external SQL
function callers and zero NORMAL catalog dependents. Both currently
deployed `loc-kysely` variants use the identical source hash; inspection
found no SQL invocations of these sixteen read RPCs. Name-compatible
Kysely actions such as `read_app_bootstrap` are unaffected.

This batch **does not** drop `silver.new_keyword_tree_uid`,
`silver.import_shared_keyword_class`, authorization, RLS, policy, or
trigger helpers. The first batch intentionally left the SQL UID allocator available until
both Edge deployments received the direct Base62 UID implementation.
That second deployment was completed before the final RPC retirement.

The migration uses exact function signatures and `RESTRICT` only.
It does not add or change any table, column, index, permission or
Anchor `attr`, and never scans Galaxy articles or anchor rows.
After application, verify these sixteen SQL functions are absent and
the direct Kysely `analytics` and `publicAction` paths remain available.


## Final SQL business RPC retirement (2026-11-06)

`supabase/migrations/20261106200000_retire_final_19_business_rpcs.sql`
retires the **remaining 19 business functions** in `api` and `silver`.
Exact current PostgreSQL signatures and zero catalog dependency counts were
verified before the SQL migration. PL/pgSQL source was checked for callers
outside the retirement set; no such SQL callers remain.

The independent `loc-kysely` and `loc-kysely-clerk` deployments were
updated first to include the existing `allocateAnchorUid` Base62 routine
and verified to contain no call to `silver.new_keyword_tree_uid(text)`.
Their routing and authorization mechanism remains unchanged. No new
fallbacks, duplicated authorization logic, or full-corpus comparisons
were added.

Only `DROP FUNCTION ... RESTRICT` is used; **no table, column, index,
RLS policy, permission, Anchor attr, or Galaxy field is changed**.
The existing `api.manage()` permission function and helper functions
used by identity, database constraints and triggers are explicitly
excluded. SQL routine names previously exposed as public-action or
managed-action operations remain available in their **Kysely** form;
those JavaScript actions are not SQL stored functions.

Retirement is verified by checking `pg_proc` for the 19 function
signatures after applying the migration and separately checking
that the retained seven helper routines still exist.


## Portable delegation Edge boundary — staged, not deployed (2026-11-06)

- The Edge gateway accepts a **LOC-signed delegation** (`iss=loc`,
  `aud=loc-delegation`, `me=true`, verified email and subject), rather than
  verifying a Clerk, database-vendor or Google token per SQL request.
  The signing secret `LOC_DELEGATION_SECRET` remains server-side and must be
  configured before this Edge implementation can accept private operations.
- **Auth Portable delegation boundary:** an externally verified OAuth,
  AD, LDAP or other principal can be mapped manually by the trusted LOC operator
  to a LOC subject, email and allowed Scope grants. The existing
  `scripts/loc-delegation-mint-token.mjs` supports this manual conversion
  with `LOC_DELEGATION_SUB`, `LOC_DELEGATION_EMAIL` and
  `LOC_DELEGATION_GRANTS`; it is not an external identity verifier.
  Optional provider adapters may automate the same conversion. Neither
  the external provider nor its original token is required on subsequent
  LOC Edge calls. The database driver's own connection authentication is
  independent and remains the DB operator's responsibility.
- Public reads no longer require a vendor publishable-key check; existing SQL
  allowlists, public data rules, query bounds and search QoS remain. Private
  writes require signed LOC grants (`global:manage` or a matching
  `scope:manage`); no per-operation LOC-control-DB permission SELECT is
  performed for delegated SQL. A portable external database requires only
  its own Galaxy and Anchor tables.
- MCP uses the separate signed audience `loc-mcp` (ordinary SQL uses
  `loc-delegation`). MCP reads/writes require a matching signed Scope grant;
  a narrow MCP `scope:write` is accepted by its fixed managed write action
  but cannot be reused as a general SQL management credential.
- For private operator bootstrap only, `scripts/loc-delegation-mint-token.mjs`
  can issue an expiring LOC delegation for either SQL (default) or MCP
  (`LOC_DELEGATION_AUDIENCE=mcp`) using the same protected secret. It is
  **not** an OAuth callback or a public token-issuance API. Never place this
  signing secret in browser code, public metadata or Git.
- This branch changes no schema, RLS, SQL roles, DB account, or production
  secrets. **Do not deploy these Edge changes** until the LOC issuer/adapter,
  browser and MCP callers provide matching LOC delegations and their live
  write/read paths pass regression testing. An old Clerk token will now be
  rejected by this candidate Edge: that is the intentional provider removal,
  not a completed client cutover. No live replacement is claimed.


### LOC-owned delegation transfer and revocation

- The gateway validates the signed LOC identity and grants locally; no
  database-side RLS, provider session lookup or SQL permission SELECT is
  needed merely to evaluate the delegation.
- Manual conversion uses a trusted operator, **after** independently verifying
  the originating principal. Set `LOC_DELEGATION_SUB` to the LOC-owned stable
  principal, `LOC_DELEGATION_EMAIL` to its verified email,
  `LOC_DELEGATION_GRANTS` to explicit scope grants, and
  `LOC_DELEGATION_AUDIENCE` to `sql` or `mcp`. Switching Google to another
  identity provider must not automatically authorize that principal: the LOC
  operator or a trusted adapter confirms the new identity-to-LOC mapping.
- Each delegated token carries a unique `sid`, an `iat` and an `exp` (max
  24 hours). The gateway rejects expired or overlong tokens even when their
  signature is valid; the operator issuer defaults to one hour.
- To revoke **one** issued delegation, configure
  `LOC_DELEGATION_REVOKED_SIDS` as a comma/space/semicolon-separated list of
  `sid` values. To invalidate all old delegations, set
  `LOC_DELEGATION_NOT_BEFORE` to a Unix timestamp in seconds. Either operation
  must be propagated to every running Edge instance: this environment-backed
  mechanism does **not** claim instant global revocation before propagation.
  Rotation of `LOC_DELEGATION_SECRET` invalidates all previous signatures.
- Revoking a token is not deleting or migrating Galaxy / Anchor. Database
  selection remains a separately configured trusted connection alias; external
  DBs supply their two data tables. No new LOC authorization table or SQL RPC.
- Existing Clerk/other OAuth client tokens **cannot** call this candidate Edge
  directly. The trusted LOC issuer/adapter and live clients still need to
  finish the exchange handoff before this branch can be deployed.


### One shared delegation contract (2026-11-07)

The pure module `app/loc/auth/delegation-contract.mjs` now owns **one**
implementation of issuance claims, allowed audiences, signed Scope grants,
MCP-only permissions, TTL, not-before cutoff and revoked-session matching.
`loc-kysely` only verifies the cryptographic signature and invokes this
contract; the offline operator issuer calls the same contract to construct
claims; Kysely's `loc-authorization.mjs` reuses its `canManageDelegation`
decision. No Auth-provider SDK, database connection, network call, new RPC,
RLS requirement or extra table is added to the shared policy module.

PostgreSQL session claim injection now has one Edge helper shared by SQL and
three managed MCP write/read routes, instead of four copies. This does not
force roles or PostgreSQL session settings on custom MySQL / SQL Server /
portable PostgreSQL targets. Existing RLS, when configured by the DB owner,
remains an independent database-side decision.

The source branch remains **non-deployable as a complete client cutover** until
trusted external OAuth-to-LOC exchange, browser and MCP caller updates,
revocation configuration rollout, and actual integration tests are complete.


### Auth SQL RPC inventory and verified OAuth exchange (2026-11-07)

Read-only inspection of the live PostgreSQL catalog found `api.manage(text,text)`
(47 catalog dependents) and `api.current_user_id()` (11 dependents).
They are required by current RLS policies and must **not** be dropped as
obsolete business RPCs. `api.request_claims()` and
`silver.current_auth_email()` are still called inside the SQL authorization
helpers even though their direct `pg_depend` counts are zero.
`auth.jwt()` and `auth.role()` belong to the database auth system.
The current app's remaining `.rpc('manage')` use is in a deferred Neon
PostgREST adapter/test, not the active Kysely authorization hot path.

The existing LOC Authority Worker now supports `POST /v1/delegation`:
verified external Clerk or configured secondary OIDC identity is checked
against the already stored Scope grants; it then signs a short-lived
`loc-delegation` (SQL) or `loc-mcp` (MCP) token using the common
`issueDelegation` contract. Only an established recovery root may request
`{\"global\":true}`. Normal callers must request one valid `scopeid` and a
subset of previously granted `read/write/manage` actions. The body cannot
supply its own subject, email, signing claims or connection credentials.

The Worker and the SQL Edge both require the same server-side
`LOC_DELEGATION_SECRET` (never in client code). These tokens last **five
minutes** and are not issued when identity verification, signed email,
Scope authorization or issuer configuration is missing. No additional SQL,
RLS, table, index or stored procedure is introduced.

**Cutover is still incomplete:** the branch's Clerk-backed Kysely browser
adapter now requests an identity-only or Scope-specific token from Authority
before contacting Edge. `kysely-edge.mjs` passes the operation to the
provider adapter, and the browser caches exchanges by exact external token
and grant request to avoid per-SQL OAuth network requests. Changing external
OAuth token or Scope cannot reuse a previous delegated grant. This is a
candidate browser integration, **not** an activated production path.

The currently deployed website and existing MCP/Extension clients still use
their old credential paths. Authority's MCP handlers still expect their
existing OAuth token; they have not been cut over to `loc-mcp` yet.
The signing secret must be provisioned to both trusted Authority and Edge,
and existing Authority grants must cover the requested Scope management
operations. These are not automatically derived from database RLS membership.
Complete relevant Node tests, client/Extension cutover, revocation rollout and
live read/write verification before deploying or merging this branch.


### Website Auth/RPC compatibility fixes — 2026-11-07

- Keep existing Clerk `sub` when LOC exchanges a signed Clerk session. It
  is already stored as the `owner_id` in personal `api.loc_user`,
  `api.user_settings` and `api.user_records` policies. Secondary OIDC
  subjects remain provider-separated until an explicit trusted mapping;
  equal email addresses alone must not transfer existing ownership.
- The website `manage(self)` action exchanges `{self:true}`, not an
  identity-only zero-grant token. Authority reads the principal's existing,
  unexpired `manage` grants from its Durable Object once at issuance;
  root receives `global:manage`. Public/identity-only requests remain
  zero-grant and do not imply a Scope manager.
- Default Clerk JWTs may not contain signed email. An authorized operator
  can specify a **manually verified** `email` on the existing
  `PUT /v1/grants` record for a provider + subject + Scope. Authority
  uses this binding only if no verified signed email is available.
  Conflicting active mappings fail closed. This does not create an Auth
  table, SQL RPC or new OAuth integration.
- Authenticated Anchor editors request their Scope delegation even for
  reads, so invisible or private keyword Anchors do not silently disappear
  merely because the browser supplied an identity-only token. Anonymous
  public readers remain on their independent public Kysely client.
- The PostgreSQL general SQL mutation route now enforces LOC-signed Scope
  grants **before** database RLS. Existing RLS still applies independently.
  For a standalone PostgreSQL / Cloud SQL target, `resolveSqlExecutionPort`
  chooses the portable gateway path without `SET LOCAL ROLE` or implicit
  `request.jwt.claims`; existing Supabase/Neon targets preserve their
  established RLS bridge, with an explicit `rls_enabled:false` opt-out.
- `loc-kysely` and `loc-kysely-clerk` are separately deployed Edge slugs
  backed by the same repo entrypoint. The cutover requires checking both
  deployed versions; updating a source branch does not update either slug.
- These changes remain unmerged and undeployed. Unit/source-level checks
  are not equivalent to a Node integration suite or production tests; do
  not activate the revised Edge or Authority until configured secrets,
  scoped grants and representative sign-in/read/write paths are verified.
