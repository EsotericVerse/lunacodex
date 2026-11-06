# LOC Galaxy — Chrome Extension (0.6.0: LOC website Session bridge)

This Manifest V3 extension connects to LOC MCP using a dedicated audience-bound JWT obtained from the existing LOC website Clerk Session. The user enters only Scope ID. The full-page workbench adds private Galaxy Link search/read and buttons for the existing LOC website import, bulk-update, and article management pages.

## Identity and authorization

1. Choose an existing Scope ID (`^[a-z][a-z0-9]{0,14}$`).
2. **Open LOC login**: opens the **original scenic LOC Clerk page** `https://loc.lo3rwang.cc/login/index.html` in a normal Chrome tab. This retains the full-screen “回到你的文字世界。” experience and uses the existing Clerk Google login.
3. After Clerk website login, choose **使用 LOC 網站 Session 連線**. Extension opens `https://loc.lo3rwang.cc/extension/auth-bridge.html`, where the website's existing Clerk Session obtains a separate `loc-mcp` JWT-template token bound exclusively to the LOC MCP resource. This avoids `chrome.identity.launchWebAuthFlow` for the primary login path.
4. Extension validates both `loc_connection_status` and `galaxy_link(action=check,scopeid=...)` with the **dedicated MCP-audience JWT intended for `https://loc.lo3rwang.cc/mcp`**. If Scope write authorization fails, the Extension remains disconnected. Identity alone is not a write grant.
5. Only after verification are credentials persisted. `chrome.storage.session` holds the short-lived dedicated access token; `chrome.storage.local` holds the nonsecret website bridge binding and Scope. The default Clerk website session JWT, cookies and refresh tokens are never transferred to the Extension. Both are restricted to **trusted extension contexts**, not content scripts, and never synced to the user's Chrome account. The password and client secret are never collected. The old OAuth refresh-token code remains for backward compatibility but is not used by the website bridge. Chrome storage is not a hardware vault.
6. Changing Scope immediately clears the old credentials. Disconnect clears Extension credentials **without** pretending to revoke the website's Clerk sign-in; server-side token revocation is a separate action.

ChatGPT web capture is optional and disabled by default. Only after the user's explicit Chrome site-access approval does a narrowly scoped content script observe future visible user messages. On-demand historical archiving is available only after an explicit click; unrelated websites, arbitrary external MCP forwarding or extension-side bulk import parser are excluded. Data import and bulk edits run in the existing LOC site after its independent Clerk and Scope authorization. The extension never forwards the OAuth token to those pages.

## Legacy OAuth Client registration — not required for website bridge

The Extension has a deterministic development ID **`hiaeafonocnjaclcfgjmdopbcgnafnna`**, pinned by the **public** key in the manifest. Its redirect URI is:

`https://hiaeafonocnjaclcfgjmdopbcgnafnna.chromiumapp.org/loc-galaxy`

Only the **legacy** Chrome OAuth mode depends on this Public OAuth Client. Extension 0.6.0 website bridge instead requires the `loc-mcp` JWT template described below. End users do not enter Client ID or Token.

Preferred if Clerk has **Client ID Metadata Documents (CIMD)** enabled:
- Explicitly register/allow `https://loc.lo3rwang.cc/extension/oauth/client.json` as a CIMD client in Clerk's OAuth applications. Allow `profile`, `email`, and `offline_access`; retain PKCE S256 and consent. Ensure the metadata file is publicly accessible by Clerk.
- Do **not** turn on anonymous Dynamic Client Registration merely to make the Extension work.

If CIMD is unavailable: 
- In Clerk OAuth applications, register **LOC Galaxy** as a **Public** OAuth app, requiring PKCE (S256), with the exact redirect URI above, and the scopes `profile email offline_access`.
- Put that application's **public** `client_id` (never the Client Secret) in `public/extension/oauth/config.json`, then let the existing Pages `main` pipeline publish it. The Extension fetches the value; users never enter it.
- The fixed issuer in the configuration must match `https://precise-grackle-3371.clerk.accounts.dev`, which is the current MCP issuer in code. If the production Clerk issuer changes, update the specific HTTPS host permission, issuer validation and server configuration together.

The legacy OAuth Public Client remains configured for compatibility but is no longer the primary Extension sign-in path. The new website bridge needs a Clerk **JWT template**, not another OAuth Public Client. Never put an OAuth Client Secret in the extension.

When published on the Chrome Web Store, confirm whether its assigned ID matches the pinned unpacked ID. If not, update redirect URI/metadata and OAuth registration before shipping. Never put a `client_secret` in an extension.

## Install in Chrome

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked**, select `extensions/loc-galaxy/`.
3. Click LOC Galaxy, enter `scopeid`, then click **使用 LOC 網站 Session 連線**; the new LOC web tab uses your existing Clerk website sign-in. If needed, use **開啟 LOC 登入** first.
4. Once Scope verification is successful, choose **3 · 開啟 Galaxy 工作台**. The full tab offers MCP topic search/read and buttons to open the existing Scope import/bulk-edit/article-management pages.
5. To use the web panels opened from the extension, maintain a valid **website** Clerk session and enter the website edit mode as normal. OAuth in the extension does **not** bypass the site's management permissions.

No other parameter is required of the end user. An absent Clerk JWT template or denied Scope permission is a connection blocker and must be reported explicitly.

## Verification

Run `node --test scripts/test-loc-galaxy-chrome-oauth.mjs scripts/test-loc-galaxy-workbench.mjs` for the website bridge contract, legacy PKCE callback, and manifest tests. The website JWT template, Clerk issuance, Chrome external messaging and end-to-end Scope verification still need live testing.

Read also: `docs/architecture/galaxy-link.md`. Stage 3 supports explicit JSON Recorder, and Stage 4 adds opt-in ChatGPT browser capture. Other apps/platforms and archive upload remain separate work.

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

This does **not** capture ChatGPT desktop/mobile conversations. Stage 4 adds a site-scoped optional content script and Chrome alarm; it is disabled by default. Test with `node --test scripts/test-loc-galaxy-chrome-oauth.mjs scripts/test-loc-galaxy-workbench.mjs scripts/test-loc-galaxy-recorder.mjs`, followed by actual OAuth/Scope/record/read browser verification. Version 0.6.0 must be installed/reloaded in Chrome, and the corresponding LOC website must be deployed.

## Stage 4: ChatGPT 網頁擷取（使用者自願啟用）

1. Pull 最新 `main`，到 `chrome://extensions` 對 LOC Galaxy 點 **Reload**，開啟白色工作台。
2. 點 **啟用 ChatGPT 擷取**；Chrome 只詢問 `https://chatgpt.com/*` 網站存取權，不授權其他頁面。登入 LOC 並完成 Scope OAuth 仍是前提。
3. 在 `chatgpt.com` 已開啟的對話中發送**新**使用者訊息；Extension 不會擷取啟用前的歷史內容，也不擷取 AI 回答。從啟用後首次觀察的時間（`observed_at`）產生 MCP 所需的 `sent_at`，**不是 ChatGPT 伺服器記錄的原始發送時間**。對於必須有原始時間戳的精確歷史資料，請使用來源 JSON 流程。
4. 訊息先進 Extension 的可信任本機佇列，最長 500 則；每小時 Chrome Alarm 嘗試 `galaxy_link.check` → `galaxy_link.record`，或按 **立即同步**。僅在後端確認寫入後才從待同步佇列移除；失敗保留重試。每批最多 30 則及約 70 KB。Chrome 未執行時不會自動同步，瀏覽器頁面未開啟時不能擷取。
5. 點 **停止擷取** 解除動態 Content Script 與每小時 Alarm，待同步佇列保留以便之後重新啟用；換 Scope 或中斷 Extension 會清除待同步內容，防止跨 Scope 洩漏。

限制：ChatGPT 網站 DOM 並非穩定公開來源 API，網站改版可能使擷取停止；只處理有穩定 `data-message-id`、`data-message-author-role=user` 的**新**訊息。不能宣稱完整擷取、零漏記，亦不會使用私有 ChatGPT API 或繞過存取管制。正式 Chrome 實機的訊息擷取、OAuth、回寫、失敗續傳仍需要驗證。沒有新增資料表、RLS、SQL、外部服務或長期 token 曝露。

## Stage 5：不使用 ZIP，直接封存已到上限的 ChatGPT 舊對話

1. 在 Chrome 打開 `https://chatgpt.com/c/...` 既有對話（即使已經不能再發送新訊息也可以嘗試）。
2. 點瀏覽器工具列的 LOC Galaxy Extension，完成原有 Scope OAuth 後，選擇 **封存目前 ChatGPT 舊對話**。首次使用會由 Chrome 詢問 `chatgpt.com` 網站權限。**這個功能不要求啟用持續擷取，也不要求 ChatGPT 資料匯出或 ZIP。**
3. Extension 在使用者明確操作時，對**目前分頁**執行本機內容擷取。嘗試透過頁面捲動收集載入的 user／assistant 原文和穩定訊息 ID，最多掃描 150 個捲動步驟或 2500 則可見訊息，結束時恢復原捲動位置。
4. 使用者文字存為 `user/original`；使用者按「封存目前對話」即選定當前已載入的助手回答為 `assistant/advice`。保留文字內容，不概括摘要。對話訊息的歷史發送時間不一定由公開 DOM 提供，因此 `sent_at` 僅採**此次擷取觀察時間**，**不得宣稱是 ChatGPT 原始發送時間**。
5. 將新訊息放入 Scope 綁定的可信任本機佇列，交由既有 `galaxy_link.check/record` 分批寫入；後端成功才解除暫存，並保存已確認的原始訊息 ID，重複按封存不會將相同已記錄 ID 重複排隊。失敗時保留以供重試。佇列容量、執行緒與 Connector 仍遵守原本的 QoS。
6. UI 顯示「掃描／新增暫存／確認寫入」數字；網頁缺少訊息、停止載入或虛擬化 DOM 時可能漏掉舊訊息，**沒有辦法僅靠當前 DOM 保證得到 ChatGPT 官方完整記錄**。對於沒有載入在網頁上的內容，Extension 不能憑空補寫。若需要完整歷史與準確發送時間，官方匯出仍是補救方案，而不是此功能的必經步驟。

安全：不使用 ChatGPT 私有 API，不繞過存取權限，不傳 Clerk OAuth Token 到頁面，也不在沒有明確按鈕操作時回溯歷史。不會修改 LOC SQL Schema、Authority 或 RLS。Chrome 實機 DOM 擷取與正式 OAuth→Galaxy 寫入仍需驗收。

## Website Session bridge (0.6.0) — operator configuration required

- In the **same Clerk instance** currently used by LOC website, create a JWT template named exactly **`loc-mcp`** with a static audience claim `"aud": "https://loc.lo3rwang.cc/mcp"`. Keep the built-in `iss`, `sub`, `exp`, `iat` and cryptographic Clerk signing; use RS256 and a short expiration (up to one hour). **Do not put a Clerk secret or website session token into the Extension or repository.**
- The Extension ID stays pinned to `hiaeafonocnjaclcfgjmdopbcgnafnna`. The manifest permits **external messages only from `https://loc.lo3rwang.cc/*`**. A randomly generated nonce, fixed bridge path, originating tab ID, Scope ID, and server-side token/Scope validation must all match before the Extension accepts a grant. The bridge never reads cookies directly.
- The normal LOC site Clerk login is sufficient; users are **not asked to complete another Chrome OAuth Authorization page**. The page automatically refreshes the separate audience-bound grant while the bridge tab stays open. **Keep the bridge tab open for long-running hourly sync**, or click the website-session connection button again when it closes/expires. The original site Session cannot silently refresh the Extension from a closed website tab in this architecture.
- Website login alone does not grant Galaxy read or write access: `loc_connection_status` + `galaxy_link.check` independently verify the JWT and Scope. Normal MCP tools continue using MCP QoS; the website login page itself is not charged against MCP request counts. This change does not split different MCP clients' per-subject QoS budgets.
- Actual Clerk template issuance, Chrome external messaging, and managed Scope recording must be verified in a live browser after the site deploys. If the template is absent, the bridge explicitly shows **Clerk 未核發 loc-mcp JWT Template** rather than pretending the connection succeeded.

## 0.6.1 — Chrome website message compatibility

Chrome's `runtime.onMessageExternal` for messages originating from a website may omit `sender.tab`. The trusted bridge now has a dedicated fallback listener for this case. It rejects any request unless the sender URL matches the exact LOC bridge origin/path/query and the Extension can independently retrieve the **original tab opened by its own authorization request**, bound to a random nonce and Scope. It still verifies the token and Scope with LOC MCP. The original listener continues handling cases where `sender.tab` is supplied. No Admin privileges are inferred from the browser; LOC Authority validates Root Clerk IDs and Scope grants server-side. Refresh the unpacked Extension in `chrome://extensions` after updating files.

## 0.6.2：網站授權單一訊息入口

0.6.1 將 `onMessageExternal` 註冊在原始 `background.mjs` 與 fallback 兩處，可能造成 Chrome 網站訊息回覆競爭。0.6.2 的 `background-entry.mjs` 改為載入只處理 Extension 內部訊息的 `background-core.mjs`，並只在 `website-grant-fallback.mjs` 註冊一次 `onMessageExternal`。網站驗證仍需檢查固定來源、原 Extension 開啟的分頁、nonce、Scope、短效 JWT 與 MCP 權限。Chrome 已安裝的 0.6.1 不會因 GitHub merge 自動變成 0.6.2。

## 0.6.3 — 授權通訊先驗證，避免無謂 Clerk Token 核發

在呼叫 Clerk `getToken({template:'loc-mcp'})` 之前，網站先以 `locGalaxy.bridgeProbe` 檢查 Chrome 外部訊息通道是否能回應、Extension 是否有當次自己開啟的授權分頁、nonce/Scope 是否正確。探測不傳 Token、不呼叫 MCP、不計入 MCP 搜尋 QoS。探測失敗直接顯示具體錯誤，成功才執行專用 JWT 與原有 Scope 驗證。Extension 回應協定版號 `protocol:1`，不是將網站鎖死在單一 Extension 版本。

官方 Clerk Sync Host 另需 `@clerk/chrome-extension` SDK/bundle、Clerk allowed_origins 與 Sync Host 網域設定；目前公開站使用 development issuer，不應在缺少對應設定時直接切換登入來源。這版保留現有權限邊界，不變更 Root/Admin。

## 0.6.4 — Chrome 外部訊息來源驗證

0.6.3 的網站授權探測錯把 `sender.url` 當成一定含授權頁完整路徑及 query 的依據，結果 Extension 已接收網站訊息卻直接拒絕。0.6.4 改為檢查 Chrome 可信的 `sender.origin`（舊環境沒有時以 `sender.url` 的 **origin** 作兼容核對），並且另外透過 `chrome.tabs.get(pending.tabId)` 驗證由 Extension 主動開啟的真實授權頁、完整 nonce 和 Scope。原有 5 分鐘初次授權／24 小時續期、JWT 和 MCP Scope 權限檢查維持。只修正傳訊來源的判斷，不增權限、不新增對 Clerk 的請求。

## 0.6.5 — 不再用 Chrome Tab URL 判定網站授權

0.6.4 的探測在 `sender.origin` 通過後仍強制使用 `chrome.tabs.get(tabId).url` 比對授權頁，因此在 Chrome 未提供 URL、登入過程暫時跳轉或分頁狀態不同時誤判為「沒有匹配的授權分頁」。0.6.5 改以 Extension 自己建立的 `chrome.storage.session` 隨機 nonce、Scope、建立時間為準；Chrome 有提供 `sender.tab.id` 才另外比對 tabId。網站發訊來源仍限定 `https://loc.lo3rwang.cc`，JWT 仍透過 LOC MCP 驗證。沒有新增 Chrome 權限。

授權頁若因 Extension Reload 而失去 session pending，會明確提示「沒有待處理的授權請求」；須由 Extension 再按一次網站 Session 授權以建立新的 nonce（**不須登出或重新登入 Clerk**）。若 nonce 或有效期限不一致會顯示不同訊息。修改僅限橋接，不調整 Root/Admin 權限。
