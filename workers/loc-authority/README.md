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


## 2026-11-09：原生 LOC Auth、平行 Auth Ref 與 Kysely SQL Data Method

### 身分主權

既有 auth.lo3rwang.cc Worker 仍是唯一 LOC OAuth 2.1 issuer，網站、MCP、Extension 沿用其 PKCE、RS256、Refresh Session 和 Scope 委託。新增 Better Auth 1.7.18 只用於 LOC 自有 Email／Password／Session，不以 GitHub、Clerk、LDAP 或任何供應商為強制上游。登入端點為 /api/auth/sign-up/email、/api/auth/sign-in/email；/v1/auth/session 可接續原生 Session。

Better Auth 透過現有 LOC Authority Durable Object 的自訂 KV Adapter 儲存帳號和 Session；不修改或建立使用者資料庫 SQL Table、Column 或 Index。使用者 Email、Session Token、OAuth Account 有原生 KV 唯一性索引，避免對所有 Session 反覆全量掃描。

未經證明的原生註冊 Email **不直接繼承**既有 Email 帳戶的管理權限；LOC Scope 授權仍獨立判斷。可在 Worker 配置 LOC_AUTH_EMAIL_ENDPOINT（HTTPS 自營寄信接收端）與 LOC_AUTH_EMAIL_TOKEN（32 字元以上），接收 JSON 的 to、subject、verify_url，由營運者寄出 Better Auth 驗證連結。這是郵件傳輸，不是外部 Auth。未設定時仍可建立 LOC 帳號與 Session，但不得宣稱 Email 已驗證。

### 橫向 Auth Ref（非上級委託）

可選擇 GitHub、OIDC、Microsoft Entra、AD/LDAP（企業自行營運的 OIDC Bridge）、Clerk JWT Ref。各 Provider 的 Issuer、Client ID、Secret 與授權 URL 由管理員設定，不強迫其他使用者啟用。

已登入原生 LOC 帳號後可導航至 /oauth/ref?provider=github|oidc|entra|ad|ldap 進行 OAuth Ref；使用者仍保有原 LOC Subject 和 Session。服務驗證 State、CSRF、Nonce、JWT Signature、Issuer、Audience、有效期限後，記錄短效權限聲明。Clerk 現有 JWT 可透過 /v1/auth/ref/check 獨立核驗；不需安裝 Clerk SDK。Ref 不自動核發 LOC Scope 權限。

AD 與 LDAP 此版透過 OIDC Bridge 互通，**並非原生 LDAP TCP Bind**。外部來源若不可驗證即拒絕指定 Ref；其他無 Ref 的 LOC 資料來源不受影響。

### Kysely SQL Data Method

管理頁的資料庫設定可選 postgres、mysql、mssql（T-SQL / SQL Server），並指定 Host／Port／Database／Schema／既有 Table／Logical-to-Physical 欄位映射及可選用的 Auth Ref 與權限 Claim。使用者選擇已授權的資料庫 ID；LOC Auth 在 Delegation 中簽署允許的目標，不把資料庫連線字串、密碼或 SQL 送到瀏覽器。

受信任 LOC 應用後端直接選用 Kysely PostgresDialect、MysqlDialect、MssqlDialect 與各自的驅動程式，無 SQL Gateway，也不由 LOC Auth 執行 SQL。一次性配置 LOC_DB_PROFILE_SERVICE_TOKEN（至少 32 字元）於既有 Authority Worker 和受信任應用程式後端，兩端值相同，才能由後端透過僅提供**連線設定**的內部受保護端點讀到新配置。設定儲存後，後續切換 SQL 類型和既有資料表不需改程式碼或重新部署。

指定外部 Table 後現有 MCP 文章讀取／搜尋執行唯讀映射，要求 Scope read + manage 權限。其他 Short Import、同步與追加只能寫正式 Galaxy 資料表。公開 LOC 內容只透過固定已發佈的 Scope 表，禁止匿名客戶端任意指定資料庫、Table、SQL。

### 驗證及部署

測試涵蓋原生帳號、Session、PKCE、OAuth Ref 不取代 LOC 主體、簽章／Nonce／權限拒絕、三種 Kysely Dialect 的語法編譯、既有 Table／欄位映射，以及 Cloudflare Wrangler Dry Run。真實 AD/LDAP、Azure SQL、MySQL 仍需要對應外部伺服器和實際權限才能完成連線驗證，模擬測試不能代替生產驗收。合併 main、網站部署與 LOC Auth Worker 發布為不同狀態，須分別確認。
