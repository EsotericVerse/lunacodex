# LOC 自有 OAuth Server：部署與驗收

這個服務是 LOC 本身的 OAuth 2.1 issuer；並非 Clerk 替代轉送器，也不是 SQL Gateway。網站、MCP、Extension 以 `https://auth.lo3rwang.cc` 為統一 issuer。

## 已有原始碼

- `native-oauth.mjs`：OAuth Authorization Code + PKCE S256、Session、短效 JWT、Refresh Token rotation、GitHub/OIDC 身分來源。
- `index.mjs`：RS256 JWKS、Scope 授權及 Durable Object 儲存。LOC Auth 僅簽發授權；業務 SQL 由另一個受信任後端的 Kysely 執行。
- `wrangler.jsonc`：部署為 `loc-native-auth`，透過 Cloudflare Workers Custom Domain 綁定 `auth.lo3rwang.cc`；使用獨立 SQLite-backed Durable Object 儲存 OAuth session/grants。這個 Durable Object 不是使用者文章 SQL 資料庫。

## 上線條件

1. Cloudflare Workers 帳戶和 `lo3rwang.cc` zone 已存在（使用 Wrangler 現有設定）。
2. GitHub Actions repository secret `CLOUDFLARE_API_TOKEN` 有 Worker scripts／custom domains 的寫入權限。預設 workflow 只在主分支更新相關原始碼或手動派發時執行，先做原始碼測試及 Wrangler dry run。
3. `LOC_CONTROL_ENCRYPTION_KEY` 必須由 Cloudflare Workers Secrets 設置為長期穩定的強隨機值；不可寫入 GitHub、程式碼或客戶端。若以前的 Durable Object 與金鑰已刪除，舊 Session、授權資料和外部 Provider 配置不可假定可恢復。
4. Google OIDC / GitHub OAuth 使用原始身分提供者註冊的應用憑證，在 LOC Auth 後端受信任環境設定 `client_id`、`client_secret` 和精確 callback URL。**不可把 Clerk 重新接作 OAuth 中介。**
5. 恢復 Recovery 管理員與各 Scope grant；先驗證 `/.well-known/oauth-authorization-server`、`/.well-known/jwks.json`、`/v1/auth/session`，再逐一驗證真實登入、Scope 授權、MCP 和 Extension 寫入。公開閱讀不應依賴 Auth 服務可用性。

沒有 Provider secrets 和 Recovery 授權不能宣稱登入已恢復。切勿為了顯示成功而使用匿名編輯、舊 Clerk token 或任意資料庫權限。
