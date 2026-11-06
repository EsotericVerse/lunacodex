# LOC galaxy-link｜LOC 彩虹橋 — Chrome Extension MV3

## 新職責（0.1.0）

本 Extension 只在使用者主動按右鍵時，解析已載入的網頁 DOM，保留網頁網址、標題與來源；不讀取看不到的虛擬化歷史，不取代 LOC 網站的大量 ZIP／JSON 匯入。
它不是 MCP 對話 Recorder。MCP 對話紀錄由 `mcp.lo3rwang.cc` 的 MCP Server 管理。

- 第一次使用時按「連接 LOC」，以 Chrome 原生 `chrome.identity.launchWebAuthFlow` 執行 OAuth 授權碼 + PKCE S256。
- Auth 完全由 LOC 自有 OAuth Authorization Server 提供；Extension 不啟動網站 Clerk Bridge、不取得 Clerk Session、不使用 Supabase 或 GitHub OAuth。
- Token 有效時重用；過期且伺服器核發 refresh_token 時自動更新。被撤銷或無法刷新時才需要重新連線。
- 內容只先寫在本機 IndexedDB Queue，待 LOC 短匯入 API **完整確認**批次 ID 後刪除；沒有 KV Worker 或 KV Cron 路徑。
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

短匯入端點採 HTTPS Bearer LOC access_token，收到
`{"id":"<stable-uuid>","records":[...]}`，
確認整批已原子保存或冪等重送時回
`{"accepted":true,"id":"<same-uuid>"}`。
未確認即保留 IndexedDB Queue，不宣稱已儲存。

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
