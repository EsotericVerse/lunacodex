# LOC Portable SQL Gateway

This Deno 2 entry runs the **existing** LOC Kysely/ZenStack SQL service independently
of Supabase Functions, PostgREST, Neon Auth, and database RPC. It does not
introduce SQL schema changes or a duplicate query implementation.

## Required trusted-server environment

- `LOC_CONTROL_DB_ALIAS`: a server-only alias matching `^[a-z][a-z0-9_]{0,63}$`
- `LOC_CONTROL_DB_ENGINE`: `postgres`, `mysql` or `mssql`
- `LOC_DB_CONNECTIONS_JSON`: server secret mapping alias to `{"engine":"postgres","url":"postgresql://..."}` or equivalent supported dialect
- `LOC_AUTHORITY_ORIGIN`: `https://auth.lo3rwang.cc` (or the explicitly deployed LOC Authority)
- Optional: `LOC_DELEGATION_NOT_BEFORE`, `LOC_DELEGATION_REVOKED_SIDS`

The entry refuses startup when its own engine/alias/connection profile is
missing. In particular, it **never** implicitly reads a Supabase or Neon URL.
The canonical LOC-signed SQL handler now lives in
`app/loc/gateway/sql-handler.ts`, with its connection adapter in
`app/loc/gateway/database-connections.ts`. The Supabase Function is only a
compatibility entry that imports the canonical handler. The hosted entry
can be removed after its production traffic has switched.

## Service launch and website cutover

On a trusted host with Deno 2 and outbound database connectivity:

```sh
deno run --allow-env --allow-net --config services/loc-sql/deno.json services/loc-sql/main.ts
```

Put the service behind a trusted HTTPS gateway and configure the **website**
build with `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL=https://<your-host>/v1/sql`.
Both anonymous and delegated browser requests use the same URL.
Do not expose database credentials to browsers or to source control.
A configured independent URL is already supported by `configured.mjs`.
Preserve the legacy URL until the standalone host and credentials actually
exist; removing the fallback early would disable the website.

The serving process is the existing Deno HTTP handler and accepts POST
and OPTIONS; its route is set by your reverse proxy. The service configuration
does **not** establish DNS, hosting, credentials or production readiness.
A portable service may use the selected PostgreSQL, MySQL or SQL Server
Kysely driver, but engine-specific behavior remains in its existing adapters.
No database tests or changes are performed by this entry.

## Cloudflare Container deployment package (separate from LOC MCP)

`Dockerfile`, `cloudflare-worker.mjs` and `wrangler.jsonc` define a separate
`loc-sql` Worker and Deno Container. The external Worker accepts only
`POST /v1/sql` and CORS `OPTIONS /v1/sql`; the internal `GET /health`
returns 204 without a database query. JWT verification and SQL authorization
remain in the canonical `app/loc/gateway/sql-handler.ts`.

1. The Cloudflare account must have an active Workers plan that permits
   Containers. A committed Wrangler configuration is **not** a deployment.
2. Configure the **server-only** `LOC_DB_CONNECTIONS_JSON` Worker secret with
   the `loc_main` alias matching `LOC_CONTROL_DB_ENGINE`. Set
   `LOC_AUTHORITY_ORIGIN` to the actual independently deployed Authority.
   The database URL never belongs in public environment variables or Git.
3. Deploy `services/loc-sql/wrangler.jsonc` with Wrangler only after the
   trusted secret, account plan, and host permissions are ready. Configure a
   dedicated HTTPS hostname and confirm the Container's /health liveness
   before any website cutover. Liveness is **not** database readiness.
4. Make `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL=https://<trusted-host>/v1/sql`
   available to the website build. The server-side ISR uses
   `LOC_SQL_GATEWAY_URL` first, then the same public setting. With an
   independent URL, neither entry forwards legacy Supabase public credentials.
5. Verify public anonymous reads and legitimate delegated management using
   the production owner's normal workflow, then separately confirm the
   actual deployed page and network route. Only after independent traffic is
   established can the old Supabase Edge Functions be retired.

An independently hosted database may be PostgreSQL (including optional Neon),
MySQL or SQL Server: the server-side alias chooses the driver. Neon Auth,
Neon Data API, Supabase Auth and Supabase Edge are not requirements. LOC Auth
is maintained in its own project; this package does not modify login.

The existing `loc-kysely` Edge is deliberately retained as the compatibility
route until actual cutover. No schema, policy, RLS, migration or test data is
created or modified as part of this deployment package.
