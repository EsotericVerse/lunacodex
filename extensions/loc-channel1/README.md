# LOC Channel 1 Chrome Extension

Unpack and load this directory at `chrome://extensions` → Developer Mode → Load unpacked.

Right-click any ordinary HTTPS page → **LOC：儲存此頁至 KV**. The extension extracts only visible webpage text (not complete chat history), keeps failed submissions locally, and retries every five minutes.

Open the extension toolbar button once to configure the private Worker HTTPS URL and **write-only** scoped JWT. Do not store a Worker signing secret in the extension.

- No Clerk authorization, no `scopeid`, no direct Galaxy access.
- Worker: `workers/loc-channel1` (existing `LOC_KV`, scheduled UTC hourly sync).
- Do not deploy until an authenticated Galaxy sync handler, JWT signing secret, and deployment name have been integrated and verified.
- `LOC_GALAXY_SYNC_URL` and `LOC_GALAXY_SYNC_SECRET` are private Worker variables; Galaxy must de-duplicate by stable record id.
- One read and one write globally **are not guaranteed by KV alone**. Additional coordination is required before claiming that concurrency invariant.
- The earlier `extensions/loc-galaxy` implementation depended on Clerk / MCP and remains in Git history; this Channel 1 directory intentionally does not invoke them.

## LOC_KV reset and identity boundaries

On 2026-11-06, the seven historical `loc:*` keys were removed from the existing `LOC_KV` namespace at the owner's explicit request; a subsequent namespace key listing returned empty. The old Google Sheets era data and its previous authorizations are **not** part of Channel 1.

- New records: `pending/<UUID>`, then `archive/<UUID>` after confirmed Galaxy ingestion.
- Channel 1 ingestion uses only signed, write-scoped JWT verification locally in the Worker. **No Google OAuth, Google Sheets authorization, or Clerk OAuth**, and no `scopeid` requirement.
- The existing LOC website's separate Google/Clerk login is outside the scope of this Channel 1 change; do not inadvertently disable unrelated website login.
- The hourly scheduled sync must be authenticated server-to-server and cannot be user/CLI-triggered.
- Global single-reader / single-writer guarantees remain unimplemented; do not claim they are enforced.

## Parser modules and source independence

The input is not ChatGPT-specific: ChatGPT, Claude, Threads, Instagram, Facebook, GitHub, Suno, and ordinary user-accessible pages can be captured by a universal extractor, with optional source-specific adapters.

Reuse repository dependencies where they apply instead of implementing their behavior again:
- `@streamparser/json`: streaming large JSON exports
- `fflate`: ZIP exports
- `jsonpath-plus`: source-specific structured JSON extraction
- `immer`: predictable local transformation state

These libraries do not automatically parse platform-specific web markup. For dynamic sites, adapters need validation against actual page structure. A generic page fallback saves the visible page; it does not guarantee a complete conversation, comment thread, or export.

The production PC queue should be persistent IndexedDB, with byte-bounded batches and per-batch acknowledgements. The initial extension currently uses `chrome.storage.local` and single-record POST: it is not yet a tested large-archive importer. Keep the KV pipeline source-agnostic and never require `scopeid`, Google OAuth, or Clerk OAuth to accept records.
