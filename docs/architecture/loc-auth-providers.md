# LOC Admin 認證來源連線設定

## 管理入口

LOC `/admin/?section=enterpriseAuth` 的「認證來源設定」使用現有 Admin 工作區、Clerk Session、LOC Authority root 授權與加密 Durable Object，不新增 SQL 表或欄位。

目前正式登入來源維持 **Clerk**。管理介面可保存以下來源的連線參數：

- GitHub OAuth：Client ID、Client Secret、Callback URL。
- OIDC：Issuer URL、Client ID、Client Secret、Callback URL。
- Microsoft Entra ID：Tenant ID、Client ID、Client Secret、Callback URL。
- Neon Auth：Auth URL（/auth）、Data API URL（/rest/v1）、LOC Callback URL；不要求另外提供 Client Secret，Neon 端自行管理第三方登入憑證。
- LDAP / AD DS：經由企業自行管理的 **OIDC bridge**，填寫 bridge issuer、client ID / secret、Callback URL；瀏覽器不接受網域帳密或 Bind Password。

## API 與憑證保存

- `GET /v1/auth/providers`：僅受信任的 LOC recovery root 可讀。回傳各來源的配置狀態、非機密欄位與 `secret_configured`，不回傳 Secret。
- `PUT /v1/auth/providers/:type`：同樣需要有效的 Clerk 簽章與 recovery root；僅接受白名單欄位，校驗 HTTPS Callback 必須屬於 LOC Origin。
- Client Secret 僅在編輯期間存於 React 記憶體，透過 HTTPS Bearer 傳至 Authority，採既有 AES-GCM `LOC_CONTROL_ENCRYPTION_KEY` 加密後存入既有 `LOC_AUTHORITY_STATE` Durable Object。
- 後續調整可將 Secret 留白，保留原本加密值；不將 Secret 存入 Galaxy、Scope/LOC SQL、前端設定、URL 或 PR。

## 啟用邊界

**設定已保存 != 已接通登入。** 管理頁的非 Clerk 來源仍標記 `runtime_connected:false` 和 `active:false`。本次不提供從前端直接切換啟用的 API，避免未建置 Callback、Token 驗簽、Session 生命週期、SQL/Kysely 管理身份識別與帳號綁定前，就把既有管理員鎖在系統外。

真正啟用任一來源之前必須具備：
1. 對應的登入與 callback adapter；完整的 state / PKCE、issuer / audience / nonce 驗證或 GitHub 的 code exchange 與獨立 LOC session。
2. 與 Clerk 使用者明確綁定的 LOC immutable identity；不可僅憑相同 email 取得既有管理權限。
3. LOC Authority、MCP、Kysely Edge / SQL RLS 的相容權限檢查與回切測試，不能讓新來源的 Access Token 冒充 Clerk JWT。
4. 雙向切換的整合測試與部署驗證；Cloudflare Pages 部署不代表獨立 Authority Worker 已更新。

## 本次最小檢查

`node --test scripts/test-loc-auth-provider-settings.mjs`

這份測試覆蓋來源欄位契約、Secret 脫敏、保留既有 Secret、拒絕外部 callback、拒絕偽造 active 欄位與 LDAP/AD OIDC bridge 規則。不得把欄位測試結果當成 OAuth 已完成端到端登入驗證。

## 與 Supabase Auth、資料庫路由的界線

- **LOC 登入不使用 Supabase Auth**：現行可用認證保持 Clerk → LOC Authority；資料庫仍可用 Supabase、Neon 或其他目標。
- `db-contract.mjs` 不再把資料庫 Auth SDK（包括舊 Supabase Auth 或尚未掛上 Authority 的 Neon Auth）視為可登入 LOC 的回退來源。
- 既有獨立 Neon Auth Adapter 保留作為後續整合基礎，尚未掛入 LOC 正式登入，避免繞過 Authority 或 SQL RLS。
- LOC Authority 的授權不是「讀到 JSON 就允許操作」：Recovery root 的簽章驗證、Durable Object 的 JSON grants、Scope SQL 的管理權限與 RLS 各自具有獨立驗證責任。管理員修改設定 JSON 不應直接獲得 Scope 權限。
- **所有 Auth 的切換只能由授權管理員明確手動啟用**，禁止根據服務失聯自動切換，也禁止儲存連線資訊就自動變更現行 Session。
- 初次發布新的 Admin／Authority 設定程式需要部署包含此 API 的網站及獨立 Authority Worker。其後設定資料保存在運行時 Durable Object，可以即時讀回而不需每次改設定都重新建置；但只有真正接上運行時切換的 Provider 才能在不部署的情況下改變登入行為。
- `NEXT_PUBLIC_*` 建置環境變數和 Cloudflare Worker secrets 不能當成可立即反映的 JSON：變更後應按相關部署機制重新發布。網站的可攜 DB 連線亦應走受信任 runtime 設定而不是前端配置。
