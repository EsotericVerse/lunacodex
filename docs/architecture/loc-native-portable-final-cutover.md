# LOC Native OAuth × Direct Kysely × Portable × MCP × Extension

> Architecture rule confirmed 2026-11-08: **LOC must never use a SQL Gateway.**
> This replaces any earlier proposal for an independent `loc-sql`,
> `loc-mcp-sql`, generic `/v1/sql` transport, or provider Edge fallback.
> Do not rename a SQL Gateway or hide one inside LOC Auth.

## Ownership and execution boundaries

1. **LOC Auth** (`auth.lo3rwang.cc`) owns native OAuth 2.1 authorization-code
   + PKCE S256, access/refresh sessions, verified subjects, Scope/Group grants,
   and per-user allowed database selection. GitHub and OIDC are identity
   adapters, never compulsory SQL/Auth hosting dependencies.
2. **The trusted LOC application backend** executes actual business operations
   with the Kysely **Driver/Dialect** and optional ZenStack V3 ORM. The backend
   verifies the LOC OAuth identity and runtime Scope permission before database
   access. It connects directly to the selected SQL database; it does **not**
   forward generic SQL query envelopes to a separate HTTP service.
3. **Database credentials** never reach JavaScript running in a browser,
   extension, or general MCP client. OAuth proves the caller's identity and
   delegated rights; it is not a database login/password. Server-side runtime
   configuration and trusted encrypted LOC Auth metadata determine the actual
   connection profile.
4. **MCP and Galaxy Link Extension** invoke bounded LOC business operations.
   The server processes these with its **own** Kysely connection. Neither
   feature may access a generic SQL Gateway, Supabase Edge, provider Auth,
   provider Data API, RPC fallback, or browser-held database password.
5. **Portability:** choose SQL engine explicitly per connection. PostgreSQL
   (including databases hosted by Supabase or Neon) uses `PostgresDialect`;
   MySQL/MariaDB uses `MysqlDialect`; SQL Server/Azure SQL uses
   `MssqlDialect`. These require SQL engine drivers on the trusted backend;
   no hosting-vendor SDK is required. Distinct databases hold independent,
   non-synchronized content aligned to the LOC schema. Database ID + Scope ID
   disambiguates identical eight-character article UIDs.

## Application and data contract

The LOC application backend must offer feature-specific data operations, not
a generic remote SQL execution endpoint. Runtime authorization includes article
visibility (eight Galaxy Boolean switches), private keywords, Scope grants,
Group management, and a public read boundary for anonymous visitors.

Reuse existing `app/loc/providers/kysely-*.mjs` logic and
`zenstack/schema.zmodel`, `zenstack/native-query.mjs` as applicable. No
JOIN-heavy, nested RPC, hidden cross-database synchronization, table migration,
or broad SELECT fallback is introduced by this cutover. The schema is frozen.

Browser `app/loc/db-client.mjs` is a **client component** and cannot safely
open a TCP database connection or embed credentials. In the current static
Pages/GitHub Pages deployment it still uses a transitional public Data API.
This is not the desired direct-Kysely implementation. Do not delete that live
public reader until the normal LOC application server actually exposes the
replacement business operations and public pages have been verified.

## MCP and Extension requirements

- `mcp.lo3rwang.cc`: native LOC OAuth audience, bounded user-requested
  `site=mcp` read/search, QoS, and private append-only Galaxy writes. Historical
  PR queries remain on GitHub. SQL executes inside the LOC application backend.
- `extensions/loc-galaxy-link/`: Chrome PKCE S256, local
  `loc-channel1-queue`, stable UID receipts, batch idempotency, append-only.
  Incomplete receipts must never remove queued captures.
- `extensions/loc-galaxy-link/`: **one** extension for ordinary pages, selected
  text/areas, rendered conversations, and live recording; all capture modes
  share the existing `loc-channel1-queue`, LOC-owned OAuth and append-only
  receipt-checked importer. The former second Web Capture extension is retired.
- LOC Auth receives no externally supplied raw SQL, relation name, database
  credential or arbitrary Host URL.

## Cutover status (source, not a deployment claim)

PR #1210 and PR #1216 were merged before this clarification. PR #1248 then
mistakenly introduced a Gateway-preferred browser route. On 2026-11-08 the
remediation work restores the previous public-reader composition and removes
the two **undeployed** standalone SQL Gateway service trees and root Container
Dockerfile. Keeping the existing published data readable is intentional.

### MCP public Galaxy in-process driver (2026-11-08)

- `functions/index.js` and `functions/mcp.js` supply an in-process
  `locDirectDatabase` factory to the **existing** Cloudflare Pages MCP
  application; no extra Worker, Container, HTTP SQL service or generic SQL
  endpoint is introduced.
- `app/loc/mcp/galaxy-read.mjs` now issues **fixed Kysely SELECTs** directly:
  anonymous published Scope only, `search=true` for a search summary,
  `list=true` for an exact eight-character UID/full text, and a SQL-level
  `site=mcp/github` exclusion to avoid private record leakage even when
  historical Boolean switches are incorrect. SQL substring matching uses a
  parameterized portable `ESCAPE '!'` expression.
- The first runtime adapter uses native PostgreSQL `pg` + Kysely
  `PostgresDialect` and the **server-only** `LOC_DB_CONNECTIONS_JSON`
  + `LOC_MCP_DB_ALIAS` values. Connection pooling is reused per binding and
  profile. This is a first feature migration, **not** full multi-engine
  completion. The MySQL/SQL Server driver modules and native selected-database
  mapping still need to be wired into this exact runtime.
- Verified Cloudflare Pages project's production compatibility date
  `2026-10-01` supports Node.js compatibility. Its current production
  environment has **no direct MCP SQL credentials** yet. Until trusted
  server-side bindings are supplied and real SQL tests pass, this code is
  source-only, not a claim that MCP public reads are live.
- Private Galaxy Link read/search/record, the LOC Auth short-import path,
  Extension writes, browser public reads and the old Gateway-only modules
  remain **unconverted**; do not cut away an in-use path or claim this finishes
  Portable.

### LOC Auth / MCP Gateway registration retirement (2026-11-08)

- `scope_storage` remains a **read-only status** MCP tool. It no longer
  accepts a SQL Gateway URL, schema override, or table selection.
- `PUT /v1/mcp/scope/:scopeid` rejects retired Gateway registration with
  HTTP 410. Historic DO records are preserved without revealing their
  `endpoint` in status responses. Retired entries are explicitly marked
  `configured:false` and `needs_native_driver:true`.
- The old service-key endpoint `POST /v1/sql/runtime-profile` and its
  Gateway credential-profile implementation have been deleted. No replacement
  generic SQL endpoint is introduced into LOC Auth.
- **Private** `galaxy_link` read/search/record and Extension writes still
  contain historical Gateway-era callers until their bound Kysely operations
  are moved into the trusted LOC application runtime. This change forbids
  registering any new Gateway, but alone does not complete that migration
  or validate production private MCP functionality.

### Private Galaxy Link native read/search with LOC Auth Scope permit (2026-11-08)

- The existing MCP Pages runtime executes `galaxy_link.read` and
  `galaxy_link.search` with `executePortableMcp` from the shared Kysely
  and ZModel logic. No SQL Gateway, raw query envelope, or vendor Data API is
  called for these two read-only actions.
- Native LOC Auth provides `GET /v1/mcp/direct-permit/:scopeid/read`:
  the caller's **MCP-audience OAuth** is verified first, then the current
  Scope read grant and user-selected database are checked. This endpoint
  returns only `subject`, `scopeid`, `action`, and an authorized
  `db_target` alias; **never a database URL, password or SQL text**.
- The MCP application matches the permit's immutable subject to its own
  verified OAuth subject before SQL. It passes only the Auth-selected alias
  into its own Kysely pool and keeps the existing private
  `site=mcp` / historical PR-provenance exclusion from
  `executePortableMcp`.
- Private search now takes the existing MCP global quota with
  `kind=search`; the Authority's five-minute search interval and QoS
  therefore still apply, without double-counting an additional permit
  request. Invalid PR queries and missing `user_requested=true` never
  reach SQL.
- This source cutover **needs** the matching LOC Auth Worker version and
  trusted backend driver credentials deployed before live traffic can work.
  It does **not** migrate `galaxy_link.record` or `check`, the Chrome
  Extension short-import write, browser public reads, or remaining
  historical Gateway helpers; those require their own bounded native
  business operations. MySQL/MSSQL in the Pages runtime still require
  corresponding direct drivers, not a Gateway.

**Not yet complete:** the native LOC application backend still needs direct
Kysely execution for all website, MCP and Extension operations, corresponding
OAuth authorization, a validated hosting/runtime configuration, and real
read/write integration tests. Existing historical Gateway code must not be
reused to implement that work. Do not confuse a merged Git branch with a
successful production cutover, and do not claim that all provider dependencies
are gone while the transitional Data API is still active.

No new table/schema/column/index/RLS/policy/GRANT/RPC/migration is authorized.
No Azure trial, paid Container, DNS change, Gateway deployment, or server
database secret should be provisioned by this source-only cleanup.
