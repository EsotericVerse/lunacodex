# LOC Channel 1 — Chrome Extension / CLI / KV / Galaxy

## What the user gets

Chrome → `chrome://extensions` → Developer mode → Load unpacked:
`extensions/loc-channel1` in this repository (after its branch is merged and GitHub Desktop Pull completes).

Right-click the current web page → **LOC：解析並儲存此頁**. It parses the loaded DOM, removing menus, controls, header/footer and hidden elements. No highlighted-text capture and no claim to have the entire history of a virtualized page. The capture records source URL, title, observed timestamp and `completeness: loaded-dom-only`.

User capture is **not ChatGPT-specific**: Claude, Threads, Instagram, Facebook, GitHub and generic loaded web pages share the parser. A safe body fallback is attempted only when main/article nodes are absent. The user must already be allowed to view the content in the browser; the extension does not bypass site logins.

## PC queue

- Browser service-worker uses persistent **IndexedDB**, not `chrome.storage.local` for large content.
- A large page is split into ordered chunks with stable `group_id`, `part_index`, `part_count` and independent UUIDs; text is not silently truncated.
- Upload begins after 30 seconds of inactivity (Chrome Alarm); failures remain in IndexedDB for retry every five minutes.
- Uploads are serialized, 50 items or 600 KB per batch, whichever comes first. A batch is acknowledged only when KV confirms it. Its ID derives deterministically from included item IDs.
- If Chrome is shut down or the network is unavailable, pending chunks remain stored on the PC until later retry.
- Changing the site or opening an unrelated browser page never triggers automatic recording.

## Cloudflare

Reuses existing `LOC_KV` namespace `69132df38f8f43a6a40cae39ebfe5460`. The Worker code lives in `workers/loc-channel1`, deployed under unused Worker name **`loc-auth`** (the third Worker). There is no Google OAuth, Google Sheets authorization, Clerk OAuth, or `scopeid` in the KV intake.

- `POST /v1/batch`: one-way authenticated write. A long-lived, write-scoped HS256 JWT with `record:create` grants no read/list/search.
- KV keys: `pending/<UUID>` and (after Galaxy acknowledgement) `archive/<UUID>`. Old Google Sheets keys were deleted at user request.
- Worker Cron `0 * * * *`: first lists `pending/`. Empty → exit with **zero Galaxy calls**. Otherwise sequentially uploads batches. Failed batches are never deleted.
- There is **no** public route to trigger the hourly push, and no CLI direct Galaxy access.
- A per-PC queue and hourly Cron are serialized; KV itself does not provide a global atomic one-reader/one-writer lock across all devices.

## Private Galaxy service

Receiver source: `supabase/functions/loc-channel1-ingest/index.ts`, using the repository's existing Kysely driver.

- One fixed server-side destination controlled by `LOC_CHANNEL1_GALAXY_DESTINATION=lo3rwang` (or `lrunes`). The browser, CLI and KV records cannot choose a database or Scope.
- An independent service secret authorizes Worker → receiver. It must match on both sides.
- Original text is stored in `content`, with `site`, `site_id`, `title` and `url`. `createtime`/`date` are **not invented from capture time**. Long pages remain identifiable as ordered segments.
- All eight Galaxy visibility flags are false by default.
- Kysely transaction with PostgreSQL advisory lock and batch `site_id` lookup prevents duplicate inserts on retries, without any new table, index, trigger or RPC.

## Configuration and release requirements

The following server-side setup must succeed **before** asking the user to install and test:

1. In Cloudflare `loc-auth`: configure secret `LOC_CHANNEL1_SECRET` (HS256 signing key, 32+ random characters). Use the private operator-only script `scripts/loc-channel1-mint-token.mjs` to issue the write-only JWT.
2. In Cloudflare `loc-auth`: configure secret `LOC_GALAXY_SYNC_SECRET`, and `LOC_GALAXY_SYNC_URL=https://qlouywsdiiyiyzpoxyqy.supabase.co/functions/v1/loc-channel1-ingest`. Keep the current `LOC_KV` binding.
3. In Supabase Edge secrets: set `LOC_CHANNEL1_GALAXY_SECRET` to the same value as `LOC_GALAXY_SYNC_SECRET`, plus `LOC_CHANNEL1_GALAXY_DESTINATION` to the intended fixed scope. Deploy `loc-channel1-ingest` with JWT gateway validation disabled **because the handler verifies its own service secret**.
4. Configure Cloudflare `loc-auth` hourly Cron (it is in `workers/loc-channel1/wrangler.jsonc`).
5. From the extension Options page, enter the Worker HTTPS URL and the write-only JWT **once**. Never put signing keys, database passwords or service synchronization credentials into the Extension, GitHub source or the browser.

The LOC website's unrelated Clerk login remains untouched. No further KV schema migration is required. Secret provisioning must be verified separately from code deployment.

## Tests

`node --test scripts/test-loc-channel1-worker.mjs`

This tests JWT rejection, malformed batches, idempotent KV acceptance, zero Galaxy requests without pending records, and persistence on failed Galaxy acknowledgement. Integration smoke testing must also verify the actual published Worker URL, Supabase function response, Cron schedule, and a private Galaxy record before claiming full production readiness.
