# LOC Portable SQL Gateway

The independent LOC SQL Gateway runs the existing Kysely / ZenStack SQL
executor in Deno 2. The same backend supports PostgreSQL, MySQL and
SQL Server. A database's hosting provider does not determine its dialect.
No schema, RLS, RPC, migration or content changes are performed here.

## Configuration before the one-time Gateway deployment

All connection credentials belong in the trusted runtime, **not in Git,
a browser setting or the Chrome Extension**.

| Variable | Purpose |
|---|---|
| `LOC_CONTROL_DB_ALIAS` | Required default/control alias, such as `loc_main` |
| `LOC_CONTROL_DB_ENGINE` | Required default dialect: `postgres`, `mysql` or `mssql` |
| `LOC_DB_CONNECTIONS_JSON` | **Required** server-only JSON mapping the default alias to an `engine` and database `url` |
| `LOC_AUTHORITY_ORIGIN` | LOC Authority, normally `https://auth.lo3rwang.cc` |
| `LOC_SQL_GATEWAY_SERVICE_KEY` | Required **when retrieving a user's selected database profile** from LOC Auth; not a substitute for the default connection |
| `LOC_DELEGATION_NOT_BEFORE`, `LOC_DELEGATION_REVOKED_SIDS` | Optional delegation revocation controls |

Example shape only (do not commit real passwords):

```json
{"loc_main":{"engine":"postgres","url":"postgresql://USER:PASSWORD@DB_HOST:5432/DATABASE"}}
```

The Deno service checks that the default alias exists in
`LOC_DB_CONNECTIONS_JSON` and matches `LOC_CONTROL_DB_ENGINE` **at
startup**. A service key alone cannot serve anonymous/control-plane reads.
Dynamic PostgreSQL, MySQL and SQL Server profiles remain stored encrypted
in LOC Auth and are resolved per authorized user without rebuilding or
redeploying the Gateway.

The canonical SQL handler is `app/loc/gateway/sql-handler.ts`; the
server-only driver is `app/loc/providers/kysely-database-drivers.ts`.
The first batch (#1210) **removes** the legacy hosted SQL Function wrappers
and provider URL/API-key fallback. These changes must not be merged into
`main` until the replacement service and its website URL are available.

## Independent HTTPS ingress

The Cloudflare implementation is
`services/loc-sql/cloudflare-worker.mjs`,
`services/loc-sql/wrangler.jsonc`, and
`services/loc-sql/Dockerfile`. It uses the Cloudflare Durable Object
Container API. A separate Vercel Container project is also provisioned
but has not been deployed. Source files and DNS names alone are not
running services.

The external Worker exposes only `POST /v1/sql` and its
`OPTIONS /v1/sql` browser preflight. Its configuration and transport
errors carry readable JSON/CORS headers; the internal, database-free
`GET /health` is not published. JWT signature and LOC Scope grants are
checked by the canonical Deno SQL handler, not by the browser.

After the independent HTTPS service is actually available:

- Set the website build variable `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL`
  to the verified `https://SQL_HOST/v1/sql` endpoint.
- Set `LOC_SQL_GATEWAY_URL` for server-only ISR calls if desired.
- Configure the LOC Auth import bridge and MCP server to the same
  verified endpoint, with separate OAuth audiences and signed delegations.
- The optional bounded read-only command `npm run verify:portable-sql`
  probes the public Galaxy projection; it does not create tables.

**Do not merge #1210 or #1216 into main before this configuration.**
The independent Gateway code has no hidden hosted-provider fallback.
The currently deployed production services remain unchanged until
the PRs are merged and the explicit deployment is made.

## User database selection and Azure trial

In Settings, a user can select only the database targets exposed to that
LOC subject by the administrator. LOC Auth persists each choice and
issues signed `db_target` claims; the Gateway fetches encrypted profiles
over the server-to-server channel and selects the appropriate Kysely
dialect. The page reload clears the browser's delegation cache. No SQL
DDL, website rebuild, or Gateway redeploy is needed for switching.

An Azure SQL trial is **not required for any of the source, contract,
bootstrap, or mock transport tests**. Activate the time-limited trial only
when the independent Gateway can accept a trusted SQL Server connection;
then add the Azure profile to LOC Auth, keeping existing PostgreSQL data
and default routing unchanged.

## Chrome/MCP

The two Chrome extensions retain independent IndexedDB queues. No website
OAuth session is forwarded into them. An incomplete receipt never empties
the queue; the separate LOC Auth token and short-import write delegation
remain required. The MCP standalone SQL entry can reuse the trusted
`LOC_CONTROL_DB_ALIAS` if it has no dedicated `LOC_MCP_DB_ALIAS`.

The database schema, RLS, migrations, existing content, and active
production deployment are outside this repository cutover.
