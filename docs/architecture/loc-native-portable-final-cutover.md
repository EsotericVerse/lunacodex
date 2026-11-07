# LOC Native Auth × Portable SQL × MCP × Chrome Extension

## Canonical deployment contract

Code changes are staged as PR #1210 (native/Auth/SQL/MCP/Extension cutover)
and dependent PR #1216 (regression and Gateway contract repairs). Merge in
this order only after the independent Gateway is live. Database schemas,
migrations, grants, RPCs, RLS, existing Galaxy content, and LOC page composition
are **not** modified by either PR.

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
- The proposed Authority source now verifies native LOC OAuth only; the
  legacy Clerk recovery and browser SDK entrypoints were removed in #1210.
  Deployed production Auth has not been switched by these Git commits.
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

LOC_CONTROL_DB_ALIAS and LOC_CONTROL_DB_ENGINE describe only the **default boot**
connection used for anonymous public traffic. They do not restrict the live
per-user connections, whose engine is chosen from encrypted LOC Auth records.
For example, this *optional separate standalone test instance* would use:

    LOC_CONTROL_DB_ALIAS=azure_sql_test
    LOC_CONTROL_DB_ENGINE=mssql
    LOC_DB_CONNECTIONS_JSON={"azure_sql_test":{"engine":"mssql","url":"mssql://USER:PASSWORD@SERVER.database.windows.net:1433/DATABASE","tls":true}}

This is a placeholder format, never an actual credential. The URL and password
belong in encrypted server environment variables, not in Git or the browser.

### Runtime user selection — no deployment when switching

After the **one-time** deployment of LOC Auth and the independent SQL Gateway,
the LOC administrator can save PostgreSQL, MySQL, and Azure SQL/SQL Server
connections in LOC Auth's existing encrypted Durable Object via Settings.
The administrator explicitly enables `selectable_by_users` or specifies
`allowed_subjects`. Users can select only their own authorized targets in
Settings → 使用的資料庫. Their selection is stored per verified LOC subject.

Each new SQL/MCP delegation embeds only the target ID in the signed
`db_target` claim. The Gateway checks its signature, fetches the credential
using a **server-only** LOC service secret, and chooses the matching Kysely
Dialect and existing connection pool at request time. It never accepts a
browser-provided DB password, raw URL, arbitrary alias, or unverified engine.
Switching immediately clears the website's in-memory delegation cache by
reloading the page; it does **not** trigger a build, Worker deployment,
Container restart, schema migration, RPC, or RLS change.

The SQL Gateway and Auth Worker must each be provisioned **once** with the
same encrypted environment secret `LOC_SQL_GATEWAY_SERVICE_KEY` (43+ characters)
**for runtime user-selected profile resolution**, in addition to the default
control connection.
That secret is not a browser setting and is never committed to Git.
Only an authenticated Gateway may call
`POST https://auth.lo3rwang.cc/v1/sql/runtime-profile`; the Authority also
verifies the signed target/subject against its latest user selection.
Authorized database credentials are never returned through the public API.

Anonymous visitors keep the default data source. Signed-in visitors use their
own selection across website read, private SQL, MCP and Extension imports.
A 5-second Gateway profile cache avoids repeated Authority requests during
page rendering; switching to a **different** database target takes effect on
the next request because the cache key includes the selected ID. Permission
revocations of an existing selection may take up to five seconds to propagate.

For the Azure 30-day trial, keep the existing PostgreSQL source unchanged.
After the code and initial Gateway deployment are ready, add an Azure SQL
connection in the LOC administrator screen, select the `mssql` engine, and
use bounded read-only verification. No extra Gateway deployment is needed
to switch databases. The schema remains externally managed and frozen.

The optional CLI command npm run verify:portable-sql, with environment
LOC_SQL_GATEWAY_URL=https://HOST/v1/sql, makes only one bounded public SELECT.
Its success proves the selected read path, not comprehensive SQL portability.

## Database portability

Server-side `LOC_DB_CONNECTIONS_JSON` **must** map the boot/control alias to
a real database connection. The service key alone cannot replace the default
database used by anonymous and control-plane requests. Authenticated users'
live database profiles are independently resolved from LOC Auth. A PostgreSQL instance
hosted on Supabase or Neon is just a PostgreSQL connection profile; no
Supabase Auth, Neon Auth, PostgREST, provider Data API, or provider Edge
Function is required by the standalone SQL service.

Required runtime configuration:
- SQL service: `LOC_AUTHORITY_ORIGIN`, `LOC_CONTROL_DB_ALIAS`,
  `LOC_CONTROL_DB_ENGINE`, the **required default** `LOC_DB_CONNECTIONS_JSON`,
  and `LOC_SQL_GATEWAY_SERVICE_KEY` when user-selected profiles are enabled.
- Website build: `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL=https://<sql-host>/v1/sql`.
- Auth Worker: `LOC_SQL_GATEWAY_URL=https://<sql-host>/v1/sql`,
  `LOC_RECOVERY_ROOT_LOC_SUBJECTS`, `LOC_SQL_GATEWAY_SERVICE_KEY`,
  existing Durable Object and encryption key.
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
  `LOC_DB_CONNECTIONS_JSON` default connection and
  `LOC_SQL_GATEWAY_SERVICE_KEY` shared service secret are not yet configured.
- The existing Cloudflare Pages project is named `loc`, with both
  `loc.lo3rwang.cc` and `mcp.lo3rwang.cc` custom domains.
  Its production environment has no independent SQL Gateway URL set.
- The existing `loc-authority-control` Worker is already bound to
  `auth.lo3rwang.cc`. It retains encrypted state and an explicit native-root
  subject secret. Its new OAuth code is **not yet deployed**, and
  `LOC_SQL_GATEWAY_URL` still needs a verified live SQL endpoint.
- `scripts/test-loc-four-way-cutover-contract.mjs` provides five offline,
  no-database-write cross-service source contracts in `test:authority`.
  Source-backed isolated Auth/SQL transport and bootstrap tests have also
  passed; they are **not** a complete Node/Deno runner, database, deployed
  OAuth or Chrome end-to-end test.
- PR #1210 and its dependent #1216 are **submitted but not merged**.
  Automated workflow guard and mock tests do not provision a live Gateway.
  No partial merge into `main` before the default control connection exists.

## Remaining release gates (do not pretend these passed)

1. Deploy an actual independent SQL Gateway with its **server-only**
   default connection and shared Authority service secret; confirm bounded anonymous reads and authorized
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
5. The proposed branch has already removed legacy recovery, hosted Function
   wrappers and SQL provider fallback. Bring up the replacement Auth/SQL
   endpoints first, then merge #1210 and retarget/merge #1216. Confirm the
   Cloudflare Pages, Worker and Vercel deployment states separately.

`auth.lo3rwang.cc` is currently bound to the existing Authority Worker.
`mcp.lo3rwang.cc` is an existing proxied CNAME to Cloudflare Pages.
The current Worker settings were verified to contain the native-root
secret but **not** `LOC_SQL_GATEWAY_URL` as of 2026-11-07.
No SQL, RLS or database schema changes are authorized by this work.
