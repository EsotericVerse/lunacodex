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
