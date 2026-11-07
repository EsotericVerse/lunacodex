# LOC Channel 1 independent receiver

The canonical receiver is `app/loc/gateway/channel1-receiver.ts`.
The former `supabase/functions/loc-channel1-ingest/index.ts` only imports
this file to keep deployed Channel 1 ingestion working. It contains no
separate SQL implementation.

A standalone **Deno 2** service uses:

```sh
deno run --allow-env --allow-net --config services/loc-sql/deno.json services/loc-channel1/main.ts
```

Configure these **server-only** values:

- `LOC_CHANNEL1_DB_ALIAS` — SQL connection alias
- `LOC_DB_CONNECTIONS_JSON` — matching PostgreSQL connection profile
- `LOC_CHANNEL1_GALAXY_SECRET` — existing private bearer secret (at least 32 characters)
- `LOC_CHANNEL1_GALAXY_DESTINATION` — `lo3rwang` or `lrunes`

Channel 1 retains its existing PostgreSQL transaction/UID/deduplication logic.
No table migration, RLS policy or SQL function is added. This source change
does **not** create a host, DNS route or production secret. The old Function
keeps its `SUPABASE_DB_URL`/`DATABASE_URL` compatibility fallback only
while actual hosted traffic remains on that path. No switch is performed
until a trusted standalone endpoint is configured.
