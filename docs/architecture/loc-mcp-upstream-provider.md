# LOC MCP 上游 Provider（獨立於 LOC Auth 身分 Provider）

## 入口

LOC 系統管理 → **連線與驗證** → **LOC MCP · 上游 Provider** → **開啟 Provider 管理**。只有按下「開啟 Provider 管理」才會向 LOC Auth 查詢 Session；掛載 Admin 頁面本身不會觸發上游授權查詢。

此處管理 Clerk、GitHub、Neon、Supabase 的 MCP 委託。LOC Auth 繼續為 LOC Web／MCP 確認身分，**不是** GitHub／Clerk／Neon／Supabase 的 Access Token 發證者。不要把 Admin 認證來源清單或 SQL Database Target 清單當作 MCP 上游 Provider 設定。

LOC MCP 已有 `loc_connection_status`、`read_memory`、`scope_storage`、`galaxy_link`；本功能另外提供：
- `provider_list`：已委託的上游 Provider（不返回憑證）。
- `provider_tools`：手動列出特定供應商現有 MCP 函式。
- `provider_call`：按既定 `auto / ask / deny` 政策處理函式。
- `provider_receipt`：由核准 ID 讀取結果。

上游與現有 LOC Galaxy／Kysely 操作分開；**不增加 SQL Gateway**。

## Cloudflare Pages 伺服器設定（需要運行時配置）

- KV namespace binding `LOC_MCP_PROVIDER_STORE`：專供外部 MCP 的 OAuth client registration、連線、函式政策與逐次核准。需在部署環境配置，**本程式不自動建立 Cloudflare 資源**。
- Secret `LOC_MCP_PROVIDER_ENCRYPTION_KEY`：至少 32 個高熵字元，獨立於 LOC Auth 的 Better Auth 金鑰及網站資料庫密碼。使用 AES-GCM 並將 KV Key 作為 Additional Authenticated Data。
- Secret `LOC_MCP_PROVIDER_OAUTH_JSON`（選配）：各 Provider 的 OAuth Client 登記資料，例如：
  ```json
  {
    "github": {"client_id":"<existing GitHub OAuth App ID>","client_secret":"<GitHub OAuth App secret>","scope":"read:user"},
    "clerk": {"client_id":"<registered client ID>","client_secret":""}
  }
  ```
  絕不將實際 Secret 放在 GitHub、前端、Provider 設定表單、URL、Galaxy 或 MCP Tool 回應。

若 Provider 支援 CIMD，採用：
`https://loc.lo3rwang.cc/.well-known/loc-mcp-client`

OAuth 回呼固定：
`https://loc.lo3rwang.cc/api/mcp-provider-callback`

若上游沒有已登記客戶端也沒有 CIMD，僅在 Provider 公布合法的 Dynamic Client Registration endpoint 時，於使用者點選「連線並授權」後建立註冊；不是週期性註冊。若 Provider 不提供這些方法，必須由該 Provider 的合法設定入口手動註冊 Client ID。

**GitHub 例外**：GitHub Remote MCP 不支援 DCR。LOC Auth 自有的 OAuth 發證能力不足以直接取得 GitHub 資源的存取權；須由 GitHub 核發 Token，沿用或建立 GitHub OAuth App／GitHub App。GitHub MCP 地址是 `https://api.githubcopilot.com/mcp/`。預設申請 `read:user`，存取私人 Repo 需要額外明確設定 GitHub OAuth scopes；函式授權仍由 LOC Policy 進一步限制。

## 操作與安全

1. 使用者登入 LOC Web，開啟 Admin → MCP Provider，選擇上游。
2. LOC MCP 使用受信任的 LOC Browser Session 確認身份；上游 OAuth 用 Authorization Code + PKCE S256，非 GitHub 的標準 MCP OAuth 在授權與 Token／Refresh Token 請求都帶入 RFC 8707 `resource`，原站自己核發上游 Token。
3. 外部授權完成後，Callback 驗證隨機 state、PKCE 及當前 LOC Browser Session 綁定的 Subject。上游 Token 加密存入 KV，不給網站或 MCP Client。
4. 管理員點「管理函式」後才讀取上游 `tools/list`；新函式預設 `deny`，使用者可設 `auto`（自動執行）、`ask`（逐次批准）、`deny`（直接阻擋）。
5. `ask` 只建立有限時的 Pending 項目；管理員必須在 LOC Web 查看 Provider、函式及參數，按下「同意並執行」。純 MCP Token 持有者不能以自身呼叫代替使用者批准。狀態透過 `provider_receipt` 查詢。**在未完成跨地區強一致原子操作保障前，可能產生不可逆副作用的函式必須維持 `deny`，不能聲稱 `ask` 已能保證 exactly-once。**
6. 同一 Provider 重新授權另一個外部帳號時，也必須清除前一帳號的函式 Policy 與 Pending 項目，防止既有 `auto` 權限意外沿用。
7. 「中斷 LOC 委託」刪除 LOC 保存的 Token、Policy 及該 Provider 的未核准操作；**供應商端的 Consent 撤銷要在供應商帳戶另外執行**。
8. 沒有 Cron、背景輪詢或一個函式多次主動查詢 LOC Auth。已授權的 MCP Tool 使用自己的上游 Token。Admin Browser 操作和 OAuth Callback 才會按需查詢 LOC Auth Session。

### 部署驗收門檻

- 未配置 KV／加密金鑰時，Admin 顯示「尚未啟用」，現有 LOC MCP 工具不受影響。
- 不得因為 GitHub PR 合併或 Cloudflare Pages 發布，就宣稱已完成 Clerk、GitHub、Neon、Supabase 的實際 OAuth 授權。必須逐一使用真實帳戶驗證 Consent、Token refresh、工具清單、read、write、拒絕、逐次批准、撤銷與權限隔離。
- Cloudflare KV 為最終一致性儲存，Pending 刪除**不能作為跨所有 Worker 實例的全域原子、Exactly-Once 保證**。對不能重複執行的高風險操作維持 `deny`，直到引入經批准的強一致執行協調或上游 idempotency 保障。此限制不可略過或假稱保證。
- 依 `node --test scripts/test-loc-mcp-upstream-provider.mjs` 執行專項測試；無真實 Provider OAuth 憑證時，僅代表單元測試驗證，不代表上線驗收。
