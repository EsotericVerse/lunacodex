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
