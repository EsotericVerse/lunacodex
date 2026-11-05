# LOC MCP：Galaxy Link

## 目的與安全邊界

Galaxy Link 是跨 Agent、跨對話的 Scope 記錄與接續介面，不是另一個記憶資料庫。
每個 Scope 使用自己已授權的資料庫與 Galaxy 相容表；Scope 由 Clerk／LOC Authority 驗證，不可推測其他 Scope 的表名、憑證或內容。

對外以單一 MCP 工具 `galaxy_link`，透過 `action` 區分：
- `search`：只在使用者／Agent 明確要求接續或查架構時使用；`source=mcp` 搜對話、`source=github` 搜私人 PR 工作紀錄。後者必須通過 Clerk 和該 Scope 的 `manage` 權限；兩者均沿用 QoS，每次最多五筆 UID／標題／時間，不回傳正文。
- `read`：已知 UID 的分段讀取；以 `source=mcp`（預設）或 `source=github` 精確限制來源。GitHub 來源需要 Scope `manage`，不因取得一般 `read` 權限而公開。
- `check`：只比對 `scopeid + conversation_id + updated_at` 的 Durable Object checkpoint；不掃描 Galaxy。
- `record`：只能寫入提供的真實來源對話到 `site=mcp`，沿用安全亂數八碼 UID、批次雜湊防重與僅追加規則；不得修改 PR 紀錄。
- `update_pr`：僅更新現有 `site=github` 且標題 PR 編號相符的 UID，後端再次驗證 Scope `manage` 及原始來源；沿用既有 `update-pr` 的 Kysely 路徑，絕不新增文章，也不讓一般 `record` 覆寫。

## 呼叫契約

- `action=search`：`scopeid`、`query`（至少兩字）、選填 `limit`（至多五筆）、`source=mcp|github`（預設 MCP）。
- `action=read`：`scopeid`、`uid`；選填 `offset`、`max_chars`、`source=mcp|github`。
- `action=check`：`scopeid`、來源 `conversation_id`、`updated_at`。
- `action=update_pr`：`scopeid`、`pr_number`、`title`、`content`、`updated_at`；**`uid` 選填**（已知時用於精確限制，使用者不需要記）。後端優先由 `site_id=EsotericVerse/moon-runes-pwa#編號` 定位，舊紀錄依原標題 PR 編號核對，發現多筆或無結果拒絕；禁止修改 `site`、`site_id` 或新建文章。
- `action=record`：`scopeid`、`conversation_id`、`updated_at`、`records`，接續舊話題時可帶入從 `search` 找到的 `uid`。每批至多一百筆，正文批次最多 125000 字元。
- `records[]` 必須具備 `role`、`kind`、`sent_at`、`text`、`message_id`；`user/original` 全量保存，`assistant/advice` 僅紀錄來源端選定的實際建議，其他類型拒絕。正文只增加時間／來源標記，不改寫每則文字。
- Recorder 對每批來源紀錄計算 SHA-256 `batch_id`，將對應的內部標記寫入正文。管理型 PostgreSQL 以 `UID + site=mcp + batch_id` 的單筆條件 UPDATE 防止重複追加；其他 Scope 用既有 Scope Durable Object 讀取／PATCH，先檢查同一批是否已存在。資料庫成功但 checkpoint 確認遺失時，重送不會再追加同一批。
- 無法取得來源對話全文或更新時間，不得以模型記憶假造 `records`，亦不得聲稱已完整補登。

管理工具（Scope 設定、連線與 Group 授權）維持獨立且需要 `configure`／`manage` 權限；Galaxy Link 只統一 PR 工作紀錄入口，不把 PR 設定權限交給一般對話 `read`／`record`。

## 部署相容性

Galaxy Link 的 `search/read/check/record` 使用版本化的 `/v1/mcp/galaxy-link/*` Authority 路由；`update_pr` 轉到原有嚴格驗證的 `/v1/mcp/update-pr/*`。舊 Authority 未部署時直接拒絕新呼叫，絕不回退到舊 `sync` 整篇覆寫。部署順序應為 Kysely Edge → Authority Worker → Pages MCP Router；三者分別核對版本與功能。舊 `/v1/mcp/search/*` 繼續禁用。

## Recorder 來源與跨 Agent

MCP Server 不是 ChatGPT／Claude／其他 App 的聊天歷史 API，無法自行讀取來源訊息。已授權的來源端負責提供完整、真實的使用者發言時間、原文，以及需要保存的 AI 真實建議；不得把 Agent 操作日誌當成原話。接入任何瀏覽器擷取模組前，需驗證隱私、相容性、完整歷史擷取及裝置切換行為。

定時每小時刷新應由具備來源存取權的獨立客戶端排程，不由 MCP 背景掃描 Galaxy。若客戶端關閉或來源無法讀取，應顯示「未補登」，恢復後重試，不得聲稱完整。

對話突然達上限時，使用者可在新 Agent 說「接續之前權限的討論」；搜尋只觸發一次，預設僅在 `site=mcp` 內，Agent 由結果找到內部 UID 後讀取及延續。多筆相似話題時由使用者確認；不要假裝模型記得 UID。

## 防遺失、防重複與私密

每個來源對話的最後成功寫入時間保存在既有 Durable Object；只有資料庫確認寫入才推進。
同一 UID 的同時寫入由 Scope Durable Object 佇列序列化；管理型 PostgreSQL 執行原子追加，額外 Scope 的 PostgREST 目標採 UID 精確定位的讀取／更新。沒有附加的全文索引、關鍵詞表或週期性內容掃描。
額外 Scope 應提供相容的 Galaxy 八個 boolean 欄位；不使用已退役 `able` JSONB。管理型 lo3rwang／lrunes 的八欄資料庫預設為 false，MCP 文字與 GitHub PR 的八個欄位一律為 false，匿名 RLS 更會直接排除這兩類來源，不能僅依 list/search 旗標假定已保密。
來自不同平台的對話來源 ID 與首次話題 UID 的關係由來源端／checkpoint 保持，不依全文反查。

**目前未完成**：外部跨平台 Recorder 的安裝與每小時排程；手機、桌面版的未傳送訊息自動擷取；正式執行環境的部署與端到端驗收。沒有這些來源端能力，不得保證零漏記。

## Chrome Extension 第一階段：只開啟授權

- `extensions/loc-galaxy` 是專屬 LOC MCP 的 Manifest V3 Chrome Extension。使用者只輸入 `scopeid`；先從 Extension 開啟原本 `/login/index.html` 的完整 Clerk 登入畫面，再由 `chrome.identity.launchWebAuthFlow` 使用 OAuth 2.1 Authorization Code + PKCE S256 取得 LOC MCP 專用 Token。
- Extension 在記錄連線成功之前，以該 OAuth Token 對 `loc_connection_status` 及 `galaxy_link(action=check,scopeid)` 做身分與 Scope 寫入授權核驗；未授權不可啟用後續 Recorder。不同 Scope 不共用已授權 Token 狀態，切換 Scope 會清除舊憑證。
- 客戶端 ID 由 LOC 網站的公開 OAuth 設定提供，而非使用者輸入；正式 Clerk 須由管理者一次性註冊公開客戶端（可用 CIMD 或手動 Public Client），並核對 Chrome 回呼 URI。不啟用匿名 DCR、不在 Extension 放 Client Secret。
- 這一階段**沒有**裝入對話擷取或定時寫入，目的是先驗證登入、Scope 權限、Token 隔離與可用性；詳情見 `extensions/loc-galaxy/README.md`。OAuth 客戶端尚未在正式 Clerk 實例驗證時不得宣稱可登入。

## Chrome Extension Stage 3：來源檔案明確追加

Extension 0.3.0 增加白色工作台的本機 JSON 檔案預覽與按鈕確認，再透過受信任的 service worker 使用既有 OAuth Scope Token 呼叫 `galaxy_link.check` / `galaxy_link.record`。來源 `conversation_id`、`updated_at` 與原始訊息 ID、時間及文字由使用者提供，不推測內容、不寫入獨立資料庫。只在後端成功回報時顯示寫入成功；前端不持有 Token。

**不代表自動擷取已完成**：沒有 ChatGPT/Claude 來源介接、每小時背景排程、未傳送訊息擷取，也未完成 Chrome 實機 OAuth／寫入／重試驗證。這個版本是可審查的明確來源匯入路徑，不宣稱零漏記。

## Chrome Extension Stage 4：自願啟用的 ChatGPT 網頁擷取

- Extension `0.4.0` 增加 `chatgpt.com` 的**選配**網站權限（Chrome 使用者手動批准）；預設沒有 content script。啟用後以 `chrome.scripting.registerContentScripts` 動態註冊，關閉後取消註冊。永遠不向 ChatGPT 網頁傳遞 Clerk OAuth Token。
- 瀏覽器來源 Adapter 僅處理目前網頁可見、帶穩定 `data-message-id` 的**新**使用者訊息；不讀取啟用前歷史、不包含助手回應、不抓取所有瀏覽器分頁。時間記錄為 Extension 首次觀察（`observed_at`），不是平台來源的精確 `sent_at`；不應被誤當歷史時間定錨。
- 本機佇列以 Scope 分隔，最多 500 則；每 60 分鐘 Chrome Alarm 或用戶手動按鍵呼叫既有 `galaxy_link.check` 及 `record`。寫入成功才清除隊列；錯誤保留待重試。登出或切換 Scope 清除待寫內容以避免跨身分流通。
- Chrome 關閉或沒有對話頁面時，無法取得新訊息。因為 ChatGPT DOM 非正式來源 API，UI 更新後可能無法擷取；沒有任何零漏記承諾。正式瀏覽器與 Authority MCP 實機驗證仍是驗收條件。

## Chrome Extension Stage 5：已到上限的舊對話封存

使用者直接打開 ChatGPT 的舊對話網頁，再於 LOC Galaxy Extension Popup 明確點擊「封存目前 ChatGPT 舊對話」，不必等待 ZIP 匯出。採用目前登入頁面的已渲染 DOM 資料，不呼叫非公開 ChatGPT API、不抓取其他對話、不繞過瀏覽器權限。

擷取 user／assistant 真實文字與頁面提供的穩定 message ID；頁面未提供原始訊息時間時，只記錄本次觀察時間（不可視為歷史發送時間）。掃描捲動有限制，並以頁面已載入內容為準；若虛擬化、網路載入失敗或網站改版，必須明示不能保證完整。

將擷取紀錄送至現有 Scope 隔離的佇列，沿用 `galaxy_link.check/record`，並記錄完成的訊息 ID 以防再封存時重複排隊；確認寫入後才移除待同步紀錄。歷史訊息與持續擷取使用不同的選擇權：封存一次不代表啟用持續監視。對話 checkpoint 的更新時間並不能代表是否已寫入過所有舊訊息，故新增歷史訊息仍需交由後端批次雜湊去重判定，不能僅以較新的 checkpoint 略過。

Chrome 正式安裝／DOM 測試與 Galaxy 真實寫入仍未驗收，不能宣稱對所有達上限對話都可完整匯出。若來源網頁從未提供某段訊息，Extension 無法還原。

## Extension 0.6.0：LOC 網站 Session 授權橋接

Chrome Extension 的主要登入不再透過 `chrome.identity.launchWebAuthFlow` 另開 Clerk OAuth Consent URL。Extension 開啟同源、受信任的 `/extension/auth-bridge.html`；網站先由現有 Clerk Session 認證，然後透過 Clerk `loc-mcp` JWT Template 取得**單獨的 MCP audience 短效 Token**（`aud=https://loc.lo3rwang.cc/mcp`）。網站預設 Session JWT、Cookie、Refresh Token 不傳給 Extension。

網站只能透過 Manifest `externally_connectable` 所列 LOC 原始來源回覆。Service Worker 逐項核對網域、固定頁面、Chrome 分頁 ID、Scope、隨機 nonce、有效期，並由 MCP 後端驗證簽章與 Scope 寫入授權後才接受。刷新時只進行 MCP 身分確認，讀／寫操作仍由 Authority 每次檢查 Scope 權限，避免每次刷新都扣掉一次 Scope checkpoint 額度。

既有 `/mcp` 入口**仍使用 MCP 權限與 QoS**；這是網站 Session 的安全重用，不是將 MCP 工具變成不設限的網站 API。後台須在同一 Clerk Instance 建立 `loc-mcp` JWT Template；若未配置，應拒絕授權，不可回退到未驗證的網站 Session JWT。短效 Token 只有在授權頁分頁保留開啟時才自動續期，關閉後需要重新開啟橋接。Extension 仍不能繞過 Google/Clerk 登入或 Scope 管理權限。

驗收範圍：已寫入程式與測試；Clerk JWT Template、Chrome web→extension 外部訊息、正式 LOC Scope 讀寫尚需真實環境驗證。
