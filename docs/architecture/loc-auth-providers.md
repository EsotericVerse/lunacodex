# LOC Admin 認證來源連線設定

## 管理入口

LOC `/admin/?section=enterpriseAuth` 的「認證來源設定」使用現有 Admin 工作區、Clerk Session、LOC Authority root 授權與加密 Durable Object，不新增 SQL 表或欄位。

目前正式登入來源維持 **Clerk**。管理介面可保存以下來源的連線參數：

- GitHub OAuth：Client ID、Client Secret、Callback URL。
- OIDC：Issuer URL、Client ID、Client Secret、Callback URL。
- Microsoft Entra ID：Tenant ID、Client ID、Client Secret、Callback URL。
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
