# LOC Channel 1 independent receiver

The canonical receiver is `app/loc/import/channel1-receiver.ts`.
This is a narrowly scoped Channel 1 ingestion receiver, not a generic SQL
query service. It must never depend on the retired LOC SQL Gateway. The
historical provider Edge entry, if still running, is a cutover liability;
no new deployment should use it.

A standalone **Deno 2** service uses:

```sh
deno run --allow-env --allow-net --config services/loc-channel1/deno.json services/loc-channel1/main.ts
```

Configure these **server-only** values:

- `LOC_CHANNEL1_DB_ALIAS` — SQL connection alias
- `LOC_DB_CONNECTIONS_JSON` — matching PostgreSQL connection profile
- `LOC_CHANNEL1_GALAXY_SECRET` — existing private bearer secret (at least 32 characters)
- `LOC_CHANNEL1_GALAXY_DESTINATION` — `lo3rwang` or `lrunes`

Channel 1 retains its existing PostgreSQL transaction/UID/deduplication logic.
No table migration, RLS policy or SQL function is added. This source change
does **not** create a host, DNS route or production secret. This source does not switch a production endpoint. Cut over the existing
one-way Queue receiver only after this direct Kysely ingestion path has
been provisioned and its acknowledgements verified. Never restore a
Supabase Edge fallback or add a generic SQL Gateway.
