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
PRs #1210 and #1216 have already merged into `main`, but their merge does
**not** prove independent SQL hosting exists. The current static site keeps a
transitional public Data API reader until `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL`
points at a functioning service. Once configured, it selects the first-party
LOC OAuth delegation + Kysely Gateway transport instead of the Data API.

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

**Release gate:** do not switch the public Gateway URL or remove the
transitional public reader before a real trusted SQL connection and signed
LOC Auth delegation pass read-only checks. The canonical Gateway has no
hosted-provider fallback. Merging code, hosting a Container, and selecting
production SQL traffic are three separate steps.

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

## SQL authentication profiles (before starting Azure trial)

LOC Authority's administrator form supports SQL username/password (the default),
MySQL LDAP Simple over TLS, SQL Server NTLM and SQL Server Microsoft Entra login
methods. This is independent of LOC website OAuth identity and permissions.

- SQL username/password is the simplest first Azure SQL connectivity check.
- Microsoft Entra `Default Credential`, VM/App Service Managed Identity, access
  token, and service principal modes do not require SQL username/password.
  Entra Password login requires an explicit Client ID in Tedious.
- Service Principal Client Secret and manually supplied Access Token are stored
  only in LOC Authority's encrypted database target profile. A settings read
  returns a boolean `*_configured` indicator, never their values. Updating the
  same target and authentication mode without resubmitting the secret preserves
  its encrypted value.
- A pasted Entra access token will expire. Default Credential or a managed
  identity only works if the **Gateway execution environment** actually has
  the corresponding Azure credential or identity; deploying the Gateway to
  Cloudflare does not itself grant an Azure Managed Identity.
- PostgreSQL `tls:true` explicitly enables verified TLS; unset retains
  the existing pg connection URI SSL mode. SQL Server Azure profiles use
  encrypted TLS with server certificate validation.

The implementation/driver wiring can be verified without Azure. Actual Azure
authentication, firewall access, database grants and cross-engine SQL queries
remain separate live checks once the time-limited trial is intentionally opened.

## Chrome/MCP

The two Chrome extensions retain independent IndexedDB queues. No website
OAuth session is forwarded into them. An incomplete receipt never empties
the queue; the separate LOC Auth token and short-import write delegation
remain required. The MCP standalone SQL entry can reuse the trusted
`LOC_CONTROL_DB_ALIAS` if it has no dedicated `LOC_MCP_DB_ALIAS`.

The database schema, RLS, migrations, existing content, and active
production deployment are outside this repository cutover.
