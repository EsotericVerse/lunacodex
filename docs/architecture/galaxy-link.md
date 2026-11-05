# LOC MCP：Galaxy Link

## 目的與安全邊界

Galaxy Link 是跨 Agent、跨對話的 Scope 記錄與接續介面，不是另一個記憶資料庫。
每個 Scope 使用自己已授權的資料庫與 Galaxy 相容表；Scope 由 Clerk／LOC Authority 驗證，不可推測其他 Scope 的表名、憑證或內容。

對外以單一 MCP 工具 `galaxy_link`，透過 `action` 區分：
- `search`：只有使用者要求接續或尋找舊話題時使用。限定已授權 Scope 的 `site=mcp`；回傳最多五筆 UID／標題／建立時間，不回傳正文。既有總 QoS 限制照常生效；資料查詢設逾時，禁止定時搜尋。
- `read`：已知 UID 才執行精確讀取，必須同時屬於指定 Scope、`site=mcp`；以 `offset`／`max_chars` 分段恢復。
- `check`：只比對 `scopeid + conversation_id + updated_at` 的 Durable Object checkpoint；不掃描資料庫內容。
- `record`：呼叫端提供來源原文與更新時間；僅在變動後批次紀錄。新話題產生安全亂數八碼 Base62 UID；續寫沿用既有 UID，只追加、不可覆蓋。首次建立使用 `site=mcp`，`createtime` 與「Galaxy Link｜Scope 在建立時間開始的原始文字紀錄」標題；後續不改建立時間及標題。

## 呼叫契約

- `action=search`：`scopeid`、`query`（至少兩字）、選填 `limit`（至多五筆）。
- `action=read`：`scopeid`、`uid`；選填 `offset`、`max_chars`。
- `action=check`：`scopeid`、來源 `conversation_id`、`updated_at`。
- `action=record`：`scopeid`、`conversation_id`、`updated_at`、`records`，接續舊話題時可帶入從 `search` 找到的 `uid`。每批至多一百筆，正文批次最多 125000 字元。
- `records[]` 必須具備 `role`、`kind`、`sent_at`、`text`、`message_id`；`user/original` 全量保存，`assistant/advice` 僅紀錄來源端選定的實際建議，其他類型拒絕。正文只增加時間／來源標記，不改寫每則文字。
- Recorder 對每批來源紀錄計算 SHA-256 `batch_id`，將對應的內部標記寫入正文。管理型 PostgreSQL 以 `UID + site=mcp + batch_id` 的單筆條件 UPDATE 防止重複追加；其他 Scope 用既有 Scope Durable Object 讀取／PATCH，先檢查同一批是否已存在。資料庫成功但 checkpoint 確認遺失時，重送不會再追加同一批。
- 無法取得來源對話全文或更新時間，不得以模型記憶假造 `records`，亦不得聲稱已完整補登。

管理工具（Scope 設定、權限與 GitHub PR 寫入）維持獨立，不應混入 Galaxy Link 的讀寫權限。

## 部署相容性

所有 Galaxy Link 動作使用版本化的 `/v1/mcp/galaxy-link/*` Authority 路由。舊 Authority 未部署時直接拒絕新呼叫，絕不回退到舊 `sync` 整篇覆寫。部署順序應為 Kysely Edge → Authority Worker → Pages MCP Router；三者分別核對版本與功能。舊 `/v1/mcp/search/*` 繼續禁用。

## Recorder 來源與跨 Agent

MCP Server 不是 ChatGPT／Claude／其他 App 的聊天歷史 API，無法自行讀取來源訊息。已授權的來源端負責提供完整、真實的使用者發言時間、原文，以及需要保存的 AI 真實建議；不得把 Agent 操作日誌當成原話。接入任何瀏覽器擷取模組前，需驗證隱私、相容性、完整歷史擷取及裝置切換行為。

定時每小時刷新應由具備來源存取權的獨立客戶端排程，不由 MCP 背景掃描 Galaxy。若客戶端關閉或來源無法讀取，應顯示「未補登」，恢復後重試，不得聲稱完整。

對話突然達上限時，使用者可在新 Agent 說「接續之前權限的討論」；搜尋只觸發一次且僅在 `site=mcp` 內，Agent 由結果找到內部 UID 後讀取及延續。多筆相似話題時由使用者確認；不要假裝模型記得 UID。

## 防遺失、防重複與私密

每個來源對話的最後成功寫入時間保存在既有 Durable Object；只有資料庫確認寫入才推進。
同一 UID 的同時寫入由 Scope Durable Object 佇列序列化；管理型 PostgreSQL 執行原子追加，額外 Scope 的 PostgREST 目標採 UID 精確定位的讀取／更新。沒有附加的全文索引、關鍵詞表或週期性內容掃描。
額外 Scope 應提供相容的 Galaxy 八個 boolean 欄位；不使用已退役 `able` JSONB。
來自不同平台的對話來源 ID 與首次話題 UID 的關係由來源端／checkpoint 保持，不依全文反查。

**目前未完成**：外部跨平台 Recorder 的安裝與每小時排程；手機、桌面版的未傳送訊息自動擷取；正式執行環境的部署與端到端驗收。沒有這些來源端能力，不得保證零漏記。

## Chrome Extension 第一階段：只開啟授權

- `extensions/loc-galaxy` 是專屬 LOC MCP 的 Manifest V3 Chrome Extension。使用者只輸入 `scopeid`；先從 Extension 開啟原本 `/login/index.html` 的完整 Clerk 登入畫面，再由 `chrome.identity.launchWebAuthFlow` 使用 OAuth 2.1 Authorization Code + PKCE S256 取得 LOC MCP 專用 Token。
- Extension 在記錄連線成功之前，以該 OAuth Token 對 `loc_connection_status` 及 `galaxy_link(action=check,scopeid)` 做身分與 Scope 寫入授權核驗；未授權不可啟用後續 Recorder。不同 Scope 不共用已授權 Token 狀態，切換 Scope 會清除舊憑證。
- 客戶端 ID 由 LOC 網站的公開 OAuth 設定提供，而非使用者輸入；正式 Clerk 須由管理者一次性註冊公開客戶端（可用 CIMD 或手動 Public Client），並核對 Chrome 回呼 URI。不啟用匿名 DCR、不在 Extension 放 Client Secret。
- 這一階段**沒有**裝入對話擷取或定時寫入，目的是先驗證登入、Scope 權限、Token 隔離與可用性；詳情見 `extensions/loc-galaxy/README.md`。OAuth 客戶端尚未在正式 Clerk 實例驗證時不得宣稱可登入。
