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
