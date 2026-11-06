# LOC galaxy-link｜LOC 彩虹橋 — Chrome Extension MV3

## 新職責（0.1.0）

本 Extension 只在使用者主動按右鍵時，解析已載入的網頁 DOM，保留網頁網址、標題與來源；不讀取看不到的虛擬化歷史，不取代 LOC 網站的大量 ZIP／JSON 匯入。
它不是 MCP 對話 Recorder。MCP 對話紀錄由 `mcp.lo3rwang.cc` 的 MCP Server 管理。

- 第一次使用時按「連接 LOC」，以 Chrome 原生 `chrome.identity.launchWebAuthFlow` 執行 OAuth 授權碼 + PKCE S256。
- Auth 完全由 LOC 自有 OAuth Authorization Server 提供；Extension 不啟動網站 Clerk Bridge、不取得 Clerk Session、不使用 Supabase 或 GitHub OAuth。
- Token 有效時重用；過期且伺服器核發 refresh_token 時自動更新。被撤銷或無法刷新時才需要重新連線。
- **單一 IndexedDB Queue**：每次擷取只累積本機資料，不逐次打 API。滿 **10 次擷取**（同一頁切塊只算一次）或累積資料達 600 KB 才排定一次自動批次傳送；可在設定頁手動送出不足門檻的資料。
- 每 5 分鐘的 Alarm 只檢查已達門檻或先前傳送失敗的 Queue；空 Queue、未達門檻時不取 Token、不打 API。若遭遇 HTTP 429，優先遵守 `Retry-After`，無回覆時至少等 15 分鐘。
- 同一次 Flush 將所有待送資料依既有 600 KB／50 筆上限組包，**每包一次 HTTP POST**；即使單一批次包含多個來源，後端也必須將每個 `source_key` 對應成**不同文章 UID**。同一來源往後自動接續原 UID，**只能 Append，禁止 Update／覆蓋既有內容**。
- 內容先寫在本機 IndexedDB Queue，待 LOC 短匯入 API 完整確認批次 ID 與該批所有文章 UID 後，以單一 IndexedDB 交易清除；沒有 KV Worker 或 KV Cron 路徑。
- 短匯入 API 需做到同一批次 ID 重送時不重複寫入，否則離線重試可能造成重複文章。

## 連線契約（LOC Auth 與短匯入 API 須提供）

Extension 從 `https://loc.lo3rwang.cc/extension/oauth/config.json` 取得**公開**連線設定：

```json
{
  "issuer": "https://<LOC-managed-auth-origin>",
  "client_id": "<LOC-public-oauth-client-id>",
  "import_url": "https://<LOC-import-origin>/v1/import/short",
  "scope": "loc:import"
}
```

尖括號均為說明用佔位符，**不能直接用於正式環境**。另一邊的 LOC Auth 開發者負責確定最後網址與 client_id；不是要求使用者每次設定。此檔案舊版仍指向 Clerk 時，Extension 應拒絕而不是使用舊 OAuth。

`issuer` 需提供 OAuth Authorization Server Metadata：`/.well-known/oauth-authorization-server`，含 `issuer`、`authorization_endpoint`、`token_endpoint`，並登錄 Chrome callback `https://<extension-id>.chromiumapp.org/loc`。支援 Authorization Code + PKCE（S256），如需長期免重新登入應提供 Refresh Token。

短匯入端點採 HTTPS Bearer LOC access_token；**每批傳輸可以涉及多篇文章**，不能將批次 ID 當成文章 UID。

```json
{
  "id": "stable-batch-uuid",
  "write_mode": "append",
  "records": [
    {
      "id": "stable-event-uuid",
      "group_id": "stable-capture-uuid",
      "source_key": "https://example.org/article/1",
      "url": "https://example.org/article/1",
      "title": "來源文章",
      "kind": "capture",
      "write_mode": "append",
      "part_index": 0,
      "part_count": 1,
      "content": "此次擷取的文字"
    }
  ]
}
```

收到後，服務端由**已驗證的使用者／Scope + source_key** 取得文章 UID：首次來源新建一篇，重複來源只在原 UID 尾端追加（不是 SQL UPDATE 原文），不同來源不合併。**同批各 record.id 也須冪等去重**：即使批次組合在重試期間變化，也不能重複 Append。不得因失去本機 UID 對應而建立第二篇同來源文章。服務端負責分配並保存安全亂數 Base62 八碼 UID；Extension 不猜 UID，也不查 Galaxy 以找 UID。

成功回覆：

```json
{
  "accepted": true,
  "id": "stable-batch-uuid",
  "articles": [
    {"source_key": "https://example.org/article/1", "uid": "A1b2C3d4"}
  ]
}
```

`articles` 必須完整覆蓋該批每個不同的 `source_key`。未確認整批與 UID 映射前不清除 Queue，失敗時保留原事件 ID 等待重試。

**修改與整併**：如果舊文章有需要修正之處，服務端只能在文章尾端 **Append 待整併註記**，註明目標 UID、需修改的位置與內容；不得自動覆寫、刪改既有段落。後續可彙整待整併註記提醒管理者，但整併必須是另外明確授權的工作，不能由本次自動短匯入偷偷執行。

尾端註記以文字方式保存，例如：

```text
[待整併]
目標 UID：Ab12Cd34
原文位置：〈使用者指定或程式核對的位置〉
建議修訂：〈應如何更動的實際內容〉
狀態：待確認整併
[/待整併]
```

只在明確具備修訂資訊時追加註記；無法確定原文位置時不得自行猜測。原 UID 保持不變。**目前 Extension 只提供來源擷取佇列；待整併註記的產生與提醒屬短匯入服務／管理功能，不得在尚未實作時宣稱已自動化。**

這是短匯入 API 的**必要服務端契約**，並非宣稱目前已實作；正式 LOC Auth／短匯入服務尚未就緒前 Extension 仍會拒絕匯入。

## 短匯入服務端進度

- 核心已實作於 `app/loc/import/short-append-service.mjs`，接收一批來源事件，依 **已驗證 Scope + 使用者 + source_key** 定位各自的 Galaxy 文章。第一次建文時分配安全亂數 Base62 UID，後續只在同 UID 尾端追加。沿用原有 `site_id`、`url` 與 `content`；八個公開 Boolean 預設全部 false。
- 每筆事件內容保留 `[[LOC-Append-Event:<事件 UUID>:<內容指紋>]]` 標記，即使重新組包、批次 ID 改變，重送也不會重複追加。整批以一個資料庫交易處理；對現有 PostgreSQL Galaxy 表使用來源級排他鎖，避免同時首次寫入產生不同 UID。不新增表、欄位、索引或 RPC。
- `app/loc/import/short-import-http.mjs` 是供 LOC Auth 裝配的 HTTP 處理器，必須先驗證 Token 簽章、發行者、受眾、有效期、撤銷狀態和 Scope 的 `loc:import` 權限。可信任 `subject`、`scopeid` 只能由 LOC Auth 提供，不得從瀏覽器請求內文接受。
- 舊文章修訂只能送 `revision_note`，明確附上 `target_uid` 和 `revision_location`，在原文尾端追加待整併註記；正式整併另行處理。API 需回傳同批全部 `source_key → uid`，Extension 確認後才會一次清除 Queue。
- **正式服務依賴尚未接通**：LOC Auth 必須提供原生 OAuth Server／client_id、Scope 授權和與 Kysely 寫入層相容的可信執行身分。上述程式不以 Clerk Token 冒充 LOC 自有 Token，也不在尚未授權時開放匿名入庫。正式 `/v1/import/short` 尚需由 LOC Auth 掛載、部署並完成真實 OAuth／Galaxy 寫入驗證。
- 其他 SQL 引擎要實作與現有 PostgreSQL `postgresShortImportStore` 等效的來源序列化，不能移除鎖後宣稱已達成 portable。

## LOC Delegation → Kysely 短匯入接線

GitHub 的 `loc-kysely` SQL Gateway 已新增內部 `kind=short-import` 路由。它只接受由 LOC Authority 簽署、`aud=loc-delegation` 且明確包含 `<scopeid>:write` 的委託，不接受 Extension 直接傳來的未驗證 OAuth Token，也不接受請求自行指定 `actor`、`target` 或 SQL 表名。由已驗證 Scope＋User 決定來源文章 UID。

**正式入口** `/v1/import/short` 仍須由 LOC 自有 OAuth/Authority 掛載：驗證 Extension Bearer Access Token、發出限 Scope 的短期 SQL Delegation、以內部請求轉交 `loc-kysely` 的 `{kind:"short-import",scopeid,batch}`。前端一次 Flush 不需要自己呼叫 Delegation 或尋找 UID。

**正式部署驗收尚缺**：LOC Authority 已能自行簽發 RS256 委託 Token，SQL Gateway 透過公開 JWKS 驗簽，雙方不共用簽章 Secret。原生 LOC Auth 的 OAuth `issuer`、client_id／callback，以及 Extension 公開匯入入口仍需完成與實測。不能用現有 Clerk 上游登入冒充原生 LOC Auth 完工；Chrome→SQL 端到端寫入尚未驗證。

## 邊界與驗收

- 本分支只改 Extension，不更動 LOC Auth、MCP Router、Edge、資料庫 Schema 或舊網站登入。
- Extension 的新連線在 LOC Auth 公開設定／短匯入 API 尚未部署之前，**尚不能正式使用**；絕不可用現有 Clerk issuer 假裝通過驗收。
- Chrome `identity` 是瀏覽器內建 API，不依賴外加 npm OAuth 庫。
- 實際安裝前需驗證 LOC Auth discovery、Chrome callback、refresh_token、短匯入 API 收件回執、斷網重送及 Gallery 實際落庫；模擬測試不等於端到端通過。

## 品牌與版本

- 正式名稱：**LOC galaxy-link｜LOC 彩虹橋**，獨立從 **0.1.0** 起算，舊 Channel 1 版本不沿用。
- 原站 favicon 複製自 `public/assets/site/icons/loc-favicon.png` 至 `extensions/loc-galaxy-link/icons/loc-favicon.png`，manifest action 與 extension 共用。
- **本機佇列相容性**：既有 IndexedDB 儲存名稱 `loc-channel1-queue` 暫時保留，避免更新或改名時刪除未送達的網頁資料；僅屬內部遺留 storage key，不是產品名稱或 KV 服務。
- 新的 Extension 原始碼位置：`extensions/loc-galaxy-link/`，原 `extensions/loc-channel1/` 刪除，避免同時維護兩個版本。
