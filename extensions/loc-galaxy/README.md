# LOC Galaxy — Chrome Extension (Stage 3: explicit source Recorder)

This Manifest V3 extension connects only to LOC MCP via Clerk OAuth. The user enters only Scope ID. The full-page workbench adds private Galaxy Link search/read and buttons for the existing LOC website import, bulk-update, and article management pages.

## Identity and authorization

1. Choose an existing Scope ID (`^[a-z][a-z0-9]{0,14}$`).
2. **Open LOC login**: opens the **original scenic LOC Clerk page** `https://loc.lo3rwang.cc/login/index.html` in a normal Chrome tab. This retains the full-screen “回到你的文字世界。” experience and uses the existing Clerk Google login.
3. After Clerk website login, return to Extension and click **Verify OAuth**. Chrome's `identity.launchWebAuthFlow` uses Authorization Code + PKCE S256 and the already signed-in Clerk account. The Clerk OAuth consent screen may still appear.
4. Extension validates both `loc_connection_status` and `galaxy_link(action=check,scopeid=...)` with the **OAuth access token intended for `https://loc.lo3rwang.cc/mcp`**. If Scope write authorization fails, the Extension remains disconnected. Identity alone is not a write grant.
5. Only after verification are credentials persisted. `chrome.storage.session` holds the short-lived access token; `chrome.storage.local` holds the refresh token and Scope. Both are restricted to **trusted extension contexts**, not content scripts, and never synced to the user's Chrome account. The password and client secret are never collected. Treat local refresh-token storage as sensitive; Chrome storage is not a hardware vault.
6. Changing Scope immediately clears the old credentials. Disconnect clears Extension credentials **without** pretending to revoke the website's Clerk sign-in; server-side token revocation is a separate action.

No automatic chat capture, content scripts, chat monitoring, arbitrary external MCP forwarding, unattended database writes or extension-side bulk import parser is included. Data import and bulk edits run in the existing LOC site after its independent Clerk and Scope authorization. The extension never forwards the OAuth token to those pages.

## Operator OAuth registration — required before first login

The Extension has a deterministic development ID **`hiaeafonocnjaclcfgjmdopbcgnafnna`**, pinned by the **public** key in the manifest. Its redirect URI is:

`https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc-galaxy`

The operator must configure **one** public OAuth client with the active LOC Clerk instance. End users do *not* enter a Client ID or Token.

Preferred if Clerk has **Client ID Metadata Documents (CIMD)** enabled:
- Explicitly register/allow `https://loc.lo3rwang.cc/extension/oauth/client.json` as a CIMD client in Clerk's OAuth applications. Allow `profile`, `email`, and `offline_access`; retain PKCE S256 and consent. Ensure the metadata file is publicly accessible by Clerk.
- Do **not** turn on anonymous Dynamic Client Registration merely to make the Extension work.

If CIMD is unavailable: 
- In Clerk OAuth applications, register **LOC Galaxy** as a **Public** OAuth app, requiring PKCE (S256), with the exact redirect URI above, and the scopes `profile email offline_access`.
- Put that application's **public** `client_id` (never the Client Secret) in `public/extension/oauth/config.json`, then let the existing Pages `main` pipeline publish it. The Extension fetches the value; users never enter it.
- The fixed issuer in the configuration must match `https://precise-grackle-3371.clerk.accounts.dev`, which is the current MCP issuer in code. If the production Clerk issuer changes, update the specific HTTPS host permission, issuer validation and server configuration together.

The LOC Galaxy Public Client is registered and its public client_id is present in `public/extension/oauth/config.json`; actual user/browser consent still requires live verification. Never put an OAuth Client Secret in the extension.

When published on the Chrome Web Store, confirm whether its assigned ID matches the pinned unpacked ID. If not, update redirect URI/metadata and OAuth registration before shipping. Never put a `client_secret` in an extension.

## Install in Chrome

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, select `extensions/loc-galaxy/`.
3. Click LOC Galaxy, enter `scopeid`, then follow the two login/authorization buttons.
4. Once Scope verification is successful, choose **3 · 開啟 Galaxy 工作台**. The full tab offers MCP topic search/read and buttons to open the existing Scope import/bulk-edit/article-management pages.
5. To use the web panels opened from the extension, maintain a valid **website** Clerk session and enter the website edit mode as normal. OAuth in the extension does **not** bypass the site's management permissions.

No other parameter is required of the end user. A missing operator registration or denied Scope permission is a deliberate connection blocker, not an alternate credential prompt.

## Verification

Run `node --test scripts/test-loc-galaxy-chrome-oauth.mjs scripts/test-loc-galaxy-workbench.mjs` for isolated manifest, deterministic redirect, PKCE and callback tests. Actual Clerk authorization, token issuance, browser store visibility and end-to-end Scope authorization still require a configured Clerk OAuth app and an installed Chrome Extension.

Read also: `docs/architecture/galaxy-link.md`. An explicit user-selected JSON Recorder is implemented in Stage 3; automated cross-app capture and extension-native ZIP archive upload remain later stages; this release reuses the published LOC import engine rather than duplicating it in the extension.

## Unified LOC favicon

The Extension toolbar, action and popup reuse the exact existing `assets/site/icons/loc-favicon.png` image. The same binary is published at `public/assets/site/icons/loc-favicon.png` for the LOC site, MCP `serverInfo.icons`, and Clerk OAuth `logo_uri`. Refresh the extension in `chrome://extensions` after pulling a newer version; hosted MCP icon caching is client-controlled.

## Workbench security contract

- `workbench.html` is an extension-owned page and has no content-script permissions. All Galaxy Link requests go through the Extension service worker using the validated OAuth token, which is never included in URLs, page contents, messages or returned MCP responses.
- Search uses `galaxy_link(action=search,source=mcp)` only, at most five results; it uses the existing Authority QoS and an additional 30-second client-side cooldown. Article content is fetched only when the user chooses a result and is paged via `galaxy_link(action=read)`.
- The management launch links point to the canonical `/lo3rwang/search/manage/?section=import` (or equivalent Scope path); file parsing/writing and bulk edit permission are still owned by the LOC website. A disconnected Extension refuses to open these links.
- GitHub PR writing from an Agent goes through the server-side `galaxy_link.update_pr` action, not through the Extension. This Extension release does not copy or publish PR content.

## Stage 3: explicit source Recorder

In the white workbench, select a JSON file with `conversation_id`, timezone-qualified `updated_at`, and 1–100 authentic `records` (`role`, `kind`, `sent_at`, `message_id`, `text`). `user` messages must be `original`, `assistant` messages must be explicitly selected `advice`. Optional `uid` points to an existing authorized topic. Preview source ID, count and timestamp, then click **確認追加至 Galaxy**. No file is sent until this action is confirmed.

The trusted service worker checks `galaxy_link.check` and calls `galaxy_link.record` only when `needs_save=true`; the backend owns checkpoint persistence and batch deduplication. Failed/ambiguous writes must not be marked complete. Each file is limited to 200 KB and a batch to 100 records / 120000 JSON characters. Larger exports require separately sourced batches and stable IDs. Note that a source-side `updated_at` must progress with new batches; the Extension does not manufacture timestamps or automatically scrape conversations. Current UI accepts one explicit source batch at a time.

This does **not** capture ChatGPT desktop/mobile conversations or run hourly automatic jobs. Those require platform-provided exports or a separately authorized source adapter; no Chrome content-script, tabs-history, or background scanning capability is granted. Test with `node --test scripts/test-loc-galaxy-chrome-oauth.mjs scripts/test-loc-galaxy-workbench.mjs scripts/test-loc-galaxy-recorder.mjs`, followed by actual OAuth/Scope/record/read browser verification. Version 0.3.0 is source code only until installed/reloaded in Chrome.
