# LOC MCP Portable SQL Gateway

This is the independent **Deno 2** server entry point. It talks directly to
PostgreSQL, MySQL/MariaDB or SQL Server using the **same** Kysely driver and
Z-Model-backed Galaxy executor as the existing LOC SQL transport.

It does **not** invoke Supabase Functions, Supabase Auth, PostgREST, database RPC,
or a second SQL implementation. The legacy Edge driver path is only a
compatibility re-export of `app/loc/providers/kysely-database-drivers.ts`.

## Required server-side configuration

| Environment | Purpose |
| --- | --- |
| `LOC_DB_CONNECTIONS_JSON` | Server-only aliases and credentials for the selected engine |
| `LOC_MCP_DB_ALIAS` | Alias in that JSON, e.g. `mcp_main` |
| `LOC_MCP_DB_ENGINE` | `postgres`, `mysql`, or `mssql` |
| `LOC_MCP_DB_NAMESPACE` | `silver` (current Postgres), `public`, or `dbo`, as appropriate |
| `LOC_AUTHORITY_ORIGIN` | HTTPS LOC Authority with `/.well-known/jwks.json` |
| `LOC_DELEGATION_NOT_BEFORE`, `LOC_DELEGATION_REVOKED_SIDS` | Optional LOC delegation revocation controls |

Example `LOC_DB_CONNECTIONS_JSON` **shape only** (do not commit real passwords):

```json
{
  "mcp_main": {
    "engine": "postgres",
    "url": "postgresql://<private-credentials>@<database-host>:5432/<database>"
  }
}
```

Set `LOC_MCP_DB_ALIAS=mcp_main`, `LOC_MCP_DB_ENGINE=postgres` and
`LOC_MCP_DB_NAMESPACE=silver` for the current database. Configure a different
engine and its actual namespace without editing the business SQL.

Run `deno run --allow-env --allow-net --config services/loc-mcp-sql/deno.json services/loc-mcp-sql/main.ts` in a trusted
Deno 2 service, behind an HTTPS reverse proxy. Public and delegated operations
share **POST /v1/sql**. The server starts with no database fallback: an invalid
or missing alias returns unavailable, never an implicit vendor connection.

Configure **both** the Cloudflare LOC Authority Worker and the MCP Pages function
with `LOC_MCP_SQL_GATEWAY_URL=https://<trusted-sql-host>/v1/sql`.
The Pages function uses bounded public search/UID reads. The Authority forwards
five-minute short-lived, RS256-signed LOC delegations for private `site=mcp`
search/read/sync/append. No user OAuth credential or database password is sent
to the SQL executor.

## Extension's dedicated delegated write path

Configure the LOC website build variable
`NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL=https://<trusted-sql-host>/v1/sql`
to route the **existing** `dbAuthClient.shortImport` through this independent
Gateway instead of a provider Function. The browser already receives a
scope-limited SQL delegation from LOC Authority; the extension receives
only the accepted article UID receipt. Without this variable, the Extension
write bridge refuses transfer and **preserves the IndexedDB Queue**.

The gateway accepts `short-import` using the same `processShortImport`
(batch fingerprint, original UID, deduplication, append-only) with one
`portableShortImportStore` for PostgreSQL, MySQL and SQL Server. PostgreSQL
uses transaction advisory source locks, MySQL uses connection-scoped
64-character hashed source locks released after commit, and SQL Server uses
a transaction table lock for first-insert serialization. No migration/RPC
is introduced. CORS is restricted to `https://loc.lo3rwang.cc`.

## Policy and performance

- Public HTTP requests are restricted to exactly two published Galaxy query
  shapes: a bounded summary search or an exact UID read with `list=true`.
  The Kysely policy also excludes `site=mcp` and `site=github` even when an
  article was accidentally marked searchable.
- MCP private calls verify the LOC delegation audience, Scope, issuer, lifetime
  and signature before selecting a database connection.
- Conversation search requires `user_requested=true` at the router, Authority
  and SQL executor; PR searches and PR-origin rows are excluded.
- Append-only writes use the existing UID, stable batch marker and conditional
  Kysely UPDATE, not a separate provider Function. The existing Authority
  Durable Object owns QoS/leases, retries and checkpoint ordering.
- **No stored SQL functions/RPCs or new migrations** are required.

## Release checklist

Run `node --test scripts/test-loc-mcp-sql-standalone.mjs scripts/test-loc-extension-portable.mjs` and the existing MCP/
Extension tests. The manual workflow `mcp-portable-pr.yml` also checks the
standalone TypeScript entry. Before releasing, perform real token/database
round-trips for public read, private read/search/sync/append, invalid Scope,
revoked token, PR refusal and near-limit QoS; then verify the Chrome Extension
Queue and website bridge. DNS, service hosting and credentials are operational
settings, not inferred from source code.

**Do not merge/redeploy to production until the independent HTTPS SQL service
actually exists and its endpoint is configured and verified.**

## Cloudflare Containers deployment entry (not deployed by this change)

`cloudflare-worker.mjs`, `Dockerfile` and `wrangler.jsonc` package the
existing Deno MCP/Extension SQL Gateway as a Cloudflare Container without
reimplementing any SQL or authorization. The Worker routes only
`POST /v1/sql` and its `OPTIONS` preflight. `GET /health` is an internal
process-liveness check; it does not read the database.

Cloudflare Containers entitlement and a Docker-compatible engine are required,
together with an authorized Workers/Containers deployment token. Never put a
database URL into the source, the browser, Pages public variables, or the
Wrangler configuration. Configure the selected `LOC_MCP_DB_ENGINE`,
`LOC_MCP_DB_ALIAS` and `LOC_MCP_DB_NAMESPACE` in `wrangler.jsonc`, then:

```sh
npx wrangler secret put LOC_DB_CONNECTIONS_JSON --config services/loc-mcp-sql/wrangler.jsonc
npx wrangler deploy --config services/loc-mcp-sql/wrangler.jsonc
```

`LOC_DB_CONNECTIONS_JSON` must be a server-only JSON mapping the alias to its
engine and connection URL. The Container is a single named, idle-sleeping
instance; it starts only when a request reaches the Worker. Optional
delegation revocation variables must also be configured as Worker secrets
when used by the LOC Authority.

After an HTTPS Worker is actually reachable and **the database-backed paths
are authorized for production cutover**, set
`LOC_MCP_SQL_GATEWAY_URL=https://<host>/v1/sql` on LOC Authority and on
MCP Pages, plus `NEXT_PUBLIC_LOC_MCP_SQL_GATEWAY_URL` with that same URL
in the LOC website's Pages build configuration. A Pages build is necessary
for the public variable. The existing fallback is not silently switched.

The Cloudflare connector used for this change lacks permission to provision
Containers (401), so these deployment files do not establish live hosting,
credentials, DNS, or a validated database round-trip. No production settings,
database structure, RLS or RPC were modified.
