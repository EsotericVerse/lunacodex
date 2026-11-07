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
- `extensions/loc-web-capture-v2/`: separate capture consent and
  `loc-web-capture-v2` IndexedDB Queue. Never pass website or extension
  OAuth tokens to each other.
- LOC Auth receives no externally supplied raw SQL, relation name, database
  credential or arbitrary Host URL.

## Cutover status (source, not a deployment claim)

PR #1210 and PR #1216 were merged before this clarification. PR #1248 then
mistakenly introduced a Gateway-preferred browser route. On 2026-11-08 the
remediation work restores the previous public-reader composition and removes
the two **undeployed** standalone SQL Gateway service trees and root Container
Dockerfile. Keeping the existing published data readable is intentional.

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
