# LOC Galaxy — Chrome Extension (Stage 1: Clerk OAuth)

This is an **LOC MCP-only** Chromium Manifest V3 extension. The end user enters just a `scopeid`. It does not connect to another MCP, monitor chat content, or capture browser pages at this stage.

## Identity and authorization

1. Choose an existing Scope ID (`^[a-z][a-z0-9]{0,14}$`).
2. **Open LOC login**: opens the **original scenic LOC Clerk page** `https://loc.lo3rwang.cc/login/index.html` in a normal Chrome tab. This retains the full-screen “回到你的文字世界。” experience and uses the existing Clerk Google login.
3. After Clerk website login, return to Extension and click **Verify OAuth**. Chrome's `identity.launchWebAuthFlow` uses Authorization Code + PKCE S256 and the already signed-in Clerk account. The Clerk OAuth consent screen may still appear.
4. Extension validates both `loc_connection_status` and `galaxy_link(action=check,scopeid=...)` with the **OAuth access token intended for `https://loc.lo3rwang.cc/mcp`**. If Scope write authorization fails, the Extension remains disconnected. Identity alone is not a write grant.
5. Only after verification are credentials persisted. `chrome.storage.session` holds the short-lived access token; `chrome.storage.local` holds the refresh token and Scope. Both are restricted to **trusted extension contexts**, not content scripts, and never synced to the user's Chrome account. The password and client secret are never collected. Treat local refresh-token storage as sensitive; Chrome storage is not a hardware vault.
6. Changing Scope immediately clears the old credentials. Disconnect clears Extension credentials **without** pretending to revoke the website's Clerk sign-in; server-side token revocation is a separate action.

No automatically scheduled Recorder, content scripts, chat monitoring, text uploads, other-MCP forwarding, hidden Full-Scope search, or database changes are included in this release.

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

**Neither registration path has been completed or live-tested by this commit.** The default `client_id` is deliberately blank so a legacy Clerk instance fails closed rather than relying on insecure implicit flows.

When published on the Chrome Web Store, confirm whether its assigned ID matches the pinned unpacked ID. If not, update redirect URI/metadata and OAuth registration before shipping. Never put a `client_secret` in an extension.

## Install in Chrome

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, select `extensions/loc-galaxy/`.
3. Click LOC Galaxy, enter `scopeid`, then follow the two login/authorization buttons.

No other parameter is required of the end user. A missing operator registration or denied Scope permission is a deliberate connection blocker, not an alternate credential prompt.

## Verification

Run `node --test scripts/test-loc-galaxy-chrome-oauth.mjs` for isolated manifest, deterministic redirect, PKCE and callback tests. Actual Clerk authorization, token issuance, browser store visibility and end-to-end Scope authorization still require a configured Clerk OAuth app and an installed Chrome Extension.

Read also: `docs/architecture/galaxy-link.md`. The durable Recorder is a **later** stage, not silently enabled during OAuth onboarding.

## Unified LOC favicon

The Extension toolbar, action and popup reuse the exact existing `assets/site/icons/loc-favicon.png` image. The same binary is published at `public/assets/site/icons/loc-favicon.png` for the LOC site, MCP `serverInfo.icons`, and Clerk OAuth `logo_uri`. Refresh the extension in `chrome://extensions` after pulling a newer version; hosted MCP icon caching is client-controlled.
