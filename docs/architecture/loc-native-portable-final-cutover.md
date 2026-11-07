# LOC Native Auth × Portable SQL × MCP × Chrome Extension

## Canonical deployment contract

The unified cutover has a single Git branch and a single merge. Database schemas,
migrations, grants, RPCs, RLS, existing Galaxy content, and LOC page composition
are **not** modified by this change.

| Role | Endpoint | Token contract |
|---|---|---|
| LOC Auth / issuer | `https://auth.lo3rwang.cc` | Native OAuth 2.1, PKCE S256, signed RS256 JWT |
| Website session | `https://auth.lo3rwang.cc/v1/auth/session` | `aud=https://loc.lo3rwang.cc` |
| MCP Server | `https://mcp.lo3rwang.cc/mcp` | `aud=https://mcp.lo3rwang.cc` |
| Chrome short import | `https://auth.lo3rwang.cc/v1/import/short` | `aud=https://auth.lo3rwang.cc/v1/import/short`, `scope=loc:import` |
| Standalone SQL Gateway | **Independent HTTPS** `/v1/sql` (deployment URL not yet verified) | Signed LOC SQL delegation `iss=loc`, `aud=loc-delegation` |
| Private MCP SQL | same independent SQL Gateway | Signed LOC MCP delegation `iss=loc`, `aud=loc-mcp` |

An OAuth access token is **never** a database authorization token.
LOC Authority signs a separate, short-lived, Scope-bound SQL delegation;
the SQL Gateway verifies the signature, claims, audience, and grants.
Database credentials are server-only. Both anonymous public reads and
authorized writes pass through Kysely/ZenStack, independent of the database host.

The website is hosted on Cloudflare Pages. The Auth Worker reuses the existing
`loc-authority-control` Durable Object. The MCP entry is the Cloudflare Pages
HTTP route on `mcp.lo3rwang.cc`. Existing DNS does not imply independent
SQL Gateway deployment.

## OAuth and root ownership

- Native `/oauth/authorize` and `/oauth/token` implement authorization
  code + PKCE S256, single-use codes, renewable and rotating refresh grants.
- GitHub provider returns a **verified provider ID and verified email**.
  OIDC (including Google) validates the issuer, ID-token signature, audience,
  expiry, and nonce. An email match **never** transfers root ownership.
- Root LOC subject is explicitly pinned in the existing Cloudflare Worker
  secret `LOC_RECOVERY_ROOT_LOC_SUBJECTS`, derived from the authenticated
  GitHub account's immutable numeric ID. Its presence was verified on
  2026-11-07. The secret's value must not be copied into the repository.
- Legacy Clerk recovery support remains in existing Authority source until
  a real LOC OAuth session and authorized SQL transaction are confirmed.
  It is not part of the new website default identity adapter.
- Existing `auth-provider:` Durable Object records can hold GitHub/OIDC
  client credentials, encrypted under `LOC_CONTROL_ENCRYPTION_KEY`. The
  OAuth callbacks must be `https://auth.lo3rwang.cc/oauth/callback/github`
  and `https://auth.lo3rwang.cc/oauth/callback/oidc`.
- The former Neon Auth provider has been removed from the authentication
  provider selection. This does **not** disable connecting to a Neon
  PostgreSQL database.

## Choosing the SQL engine when adding a connection

SQL engine type is explicit. It is not guessed from the host or first query.

| Database | LOC_CONTROL_DB_ENGINE | Kysely Dialect | Default physical namespace |
|---|---|---|---|
| Supabase / Neon / PostgreSQL | postgres | PostgresDialect | silver / api |
| MySQL / MariaDB | mysql | MysqlDialect | chosen database |
| Azure SQL / SQL Server | mssql | MssqlDialect | dbo |

LOC_CONTROL_DB_ALIAS must name a server-side profile inside LOC_DB_CONNECTIONS_JSON.
The active profile's engine must match LOC_CONTROL_DB_ENGINE.
For example, to test an existing Azure SQL database in an independent test Gateway:

    LOC_CONTROL_DB_ALIAS=azure_sql_test
    LOC_CONTROL_DB_ENGINE=mssql
    LOC_DB_CONNECTIONS_JSON={"azure_sql_test":{"engine":"mssql","url":"mssql://USER:PASSWORD@SERVER.database.windows.net:1433/DATABASE","tls":true}}

This is a placeholder format, never an actual credential. The URL and password
belong in encrypted server environment variables, not in Git or the browser.

The currently deployed standalone SQL Gateway selects ONE active
connection alias and engine per instance. Changing either requires editing the
server deployment settings and restarting/redeploying that Gateway. Ordinary
read/write requests use its already-configured Kysely Dialect.

To test Azure SQL without disturbing the existing PostgreSQL main connection,
use a separate test Gateway with mssql and its own alias. MySQL likewise
has a separate alias and mysql engine. A configured dialect does not
create tables; existing Galaxy/Anchor tables must already be present.

The optional CLI command npm run verify:portable-sql, with environment
LOC_SQL_GATEWAY_URL=https://HOST/v1/sql, makes only one bounded public SELECT.
Its success proves the selected read path, not comprehensive SQL portability.

## Database portability

Server-side `LOC_DB_CONNECTIONS_JSON` maps aliases to existing database
connections. `LOC_CONTROL_DB_ALIAS` and `LOC_CONTROL_DB_ENGINE` select
one connection (`postgres`, `mysql`, or `mssql`). A PostgreSQL instance
hosted on Supabase or Neon is just a PostgreSQL connection profile; no
Supabase Auth, Neon Auth, PostgREST, provider Data API, or provider Edge
Function is required by the standalone SQL service.

Required runtime configuration:
- SQL service: `LOC_AUTHORITY_ORIGIN`, `LOC_CONTROL_DB_ALIAS`,
  `LOC_CONTROL_DB_ENGINE`, `LOC_DB_CONNECTIONS_JSON`.
- Website build: `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL=https://<sql-host>/v1/sql`.
- Auth Worker: `LOC_SQL_GATEWAY_URL=https://<sql-host>/v1/sql`,
  `LOC_RECOVERY_ROOT_LOC_SUBJECTS`, existing Durable Object and encryption key.
- MCP Pages runtime: `LOC_MCP_SQL_GATEWAY_URL=https://<sql-host>/v1/sql`;
  `LOC_MCP_AUTHORITY_URL=https://auth.lo3rwang.cc` as needed.
- Chrome Extension: public `/extension/oauth/config.json` points at
  the native LOC issuer and Auth short-import endpoint. Each browser
  installation dynamically registers its exact Chrome OAuth callback.
  IndexedDB Queue, append-only writes, batch IDs and UID receipts remain.

## Chrome Extension separation (no Queue migration)

There are **two intentionally separate MV3 products**. Do not rename a Queue,
merge IndexedDB databases, relay website Sessions, or assume a changed manifest
version represents a safe replacement:

- `extensions/loc-galaxy-link/` uses Chrome Authorization Code + PKCE S256
  with LOC Auth, stores only its own OAuth tokens, and keeps its historical
  `loc-channel1-queue` IndexedDB name. Its `/oauth/revoke` disconnect removes
  the current refresh grant server-side when reachable, while **never deleting
  pending captured records**. On HTTP failures it preserves Queue and waits
  for explicit re-authorization or retry after recovery.
- `extensions/loc-web-capture-v2/` owns the richer selection/DOM recording
  and distinct `loc-web-capture-v2` IndexedDB Queue. It uses an explicitly
  opened LOC website bridge and **never** receives LOC OAuth Access Tokens,
  Refresh Tokens, or the website's Session cookie.

Both may append text to Galaxy, but their consent, stored state, capture
workflow and upload confirmation are not interchangeable. A known source is
continued by stable UID, and an incomplete receipt never deletes a Queue.

## Deployment control / current evidence

- The Vercel project `loc-sql` exists with Container framework and preview
  builds disabled, but remains **unlinked to Git and undeployed**.
  Its non-secret settings include control alias `loc_main`, PostgreSQL engine
  and `LOC_AUTHORITY_ORIGIN=https://auth.lo3rwang.cc`. The server-only
  `LOC_DB_CONNECTIONS_JSON` connection secret is not yet configured.
- The existing Cloudflare Pages project is named `loc`, with both
  `loc.lo3rwang.cc` and `mcp.lo3rwang.cc` custom domains.
  Its production environment has no independent SQL Gateway URL set.
- The existing `loc-authority-control` Worker is already bound to
  `auth.lo3rwang.cc`. It retains encrypted state and an explicit native-root
  subject secret. Its new OAuth code is **not yet deployed**, and
  `LOC_SQL_GATEWAY_URL` still needs a verified live SQL endpoint.
- `scripts/test-loc-four-way-cutover-contract.mjs` provides five offline,
  no-database-write cross-service source contracts in `test:authority`.
  These checks also passed a source-backed isolated execution of the test
  assertions on 2026-11-07. This is **not** a Node, Deno, browser, build,
  database, or deployed OAuth end-to-end test.
- PR #1210 stays **Draft** until all endpoints, provider callbacks,
  per-Scope grants, SQL connectivity and Chrome receipt handling have
  verified release evidence. No partial merge into `main`.

## Remaining release gates (do not pretend these passed)

1. Deploy an actual independent SQL Gateway with its **server-only**
   connection secrets; confirm bounded anonymous reads and authorized
   delegated management without writing arbitrary production test data.
2. Verify the external GitHub/Google OAuth clients and callback
   configuration inside the existing Authority Durable Object. The presence
   of an auth-provider editor does not mean providers are connected.
3. Deploy the **same integrated revision** of the native Auth Worker and
   Cloudflare MCP/Pages entry, then verify PKCE, access-token audiences,
   refresh rotation, explicit root and Scope grants, QoS, Galaxy read/record,
   Chrome enqueue/append and receipts, and protected-site login.
4. Run the no-database-write regressions:
   `npm run test:authority`;
   `node --test scripts/test-loc-mcp-routing.mjs scripts/test-loc-mcp-authority.mjs scripts/test-loc-galaxy-link-extension.mjs scripts/test-loc-auth-provider-settings.mjs`;
   `deno check --config services/loc-sql/deno.json services/loc-sql/main.ts`.
5. Only once the new Auth and SQL endpoints are live and verified:
   retire Clerk-specific recovery and old Edge function **runtime**
   bindings/modules, merge the one PR, and confirm Cloudflare Pages and
   Vercel deployment states separately.

`auth.lo3rwang.cc` is currently bound to the existing Authority Worker.
`mcp.lo3rwang.cc` is an existing proxied CNAME to Cloudflare Pages.
The current Worker settings were verified to contain the native-root
secret but **not** `LOC_SQL_GATEWAY_URL` as of 2026-11-07.
No SQL, RLS or database schema changes are authorized by this work.
