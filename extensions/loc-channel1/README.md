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
