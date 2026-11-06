# LOC Portable — 身分授權與 SQL 連線分離（2026-11-07）

## 不可違反的契約

- LOC 的資料庫存取權限由 **LOC Auth / LOC Authority** 核發、驗證與委託。Clerk Auth、Supabase Auth、Neon Auth **均不得是 SQL、Kysely、公開讀取或跨庫切換的必要相依**。
- 使用者的 OAuth access token 是身分與權限證明，**不是資料庫密碼**。SQL Gateway 在伺服器端，以受控資料庫憑證連接 PostgreSQL／MySQL／SQL Server；不讓瀏覽器直接持有資料庫憑證。
- 不管是哪家資料庫託管商，LOC 授權契約、Scope 管理及 Kysely 查詢操作一致。
- 匿名公開讀取不依賴個人登入；管理寫入必須驗證 LOC Authority 所核發、具有正確 Scope／action／有效期限的委託。不得以使用者提供的 Email／Scope 欄位自行授權。
- OAuth 外部登入適配器可以是可插拔的「身分來源」，但不能被硬編碼成 LOC SQL 的要求，也不能在缺少 LOC OAuth 時偷偷回退成某個供應商的 Auth。
- 多資料庫備援必須在 SQL 層切換。選配的 `LOC_BACKUP_SQL_GATEWAY_URL` 指向**不同來源**的受控 Kysely Gateway，而不是 Neon Auth `/token/anonymous` 或 Data API／PostgREST。
- 啟用 SQL 備援前，要實測主、備 Gateway 使用各自的資料庫憑證、相同授權邊界。未設定獨立備援時，必須清楚表示未配置，不得假稱線上備援正常。

## 本次已處理

刪除不再是正式登入入口的 `neon-primary.mjs`、`neon-public.mjs`、`emergency-primary.mjs`；移除 `@supabase/postgrest-js`；ISR／公共發布改由兩個可選的 Kysely Gateway 實作來源切換。管理頁不再把 Neon Auth 能否連線當作資料庫是否支援 Neon 的證據。

Neon PostgreSQL 的存取功能仍由 Kysely PostgreSQL 方言與資料庫連線設定提供，不因移除 Neon Auth 而移除 Neon SQL 支援。

## 尚未完成，不能宣稱已切換

**2026-11-07 的主站 `app/loc/providers/configured.mjs` 仍預設 `createClerkGatewayAdapter()`**，用 Clerk 驗證上游使用者後再向 LOC Authority 兌換委託。這是「網站登入的上游」而非 SQL 資料庫的必要驗證，但**網站端原生 LOC OAuth 登入尚未驗收完成**。

正式移除此過渡入口之前，需先具備並驗證：
1. LOC Auth 對外的 OAuth Authorization Server（正確 issuer、Authorization Code + PKCE S256、Token endpoint、回呼與續期、撤銷／逾期）。
2. LOC Authority 對該 LOC Auth 所簽發的 OAuth token 的獨立驗簽與 subject／session／Scope 授權，不使用 Clerk 取代驗簽。
3. 網站 browser account adapter 的登入、恢復 Session、登出與 Google/GitHub 可選身份來源，不再呼叫 Clerk SDK。
4. SQL Gateway 驗證 LOC delegation 的主線及部署同版驗收；不同資料庫、不同 Scope、匿名讀取、跨 Scope 拒絕均通過。

**以上驗收未完成時不得刪掉現役登入而讓正式網站鎖死，也不得宣稱全站已不依賴 Clerk。**

## MCP managed SQL transport (2026-11-07)

The existing LOC Authority Worker can now route the four managed MCP SQL
operations to an independent Kysely Gateway using the **server-only**
`LOC_MANAGED_SQL_GATEWAY_URL` Worker environment variable. A configured HTTPS
URL must include a non-root path and contain no URL credentials, query or
fragment. Local and direct IPv4 endpoints are rejected. The independent node
receives the Authority-issued audience-bound LOC MCP delegation only; it does
**not** receive a Supabase project `apikey`.

The previous Supabase Edge endpoint remains the **compatibility default** only
when that variable is absent. Thus this code change does not itself migrate
the live MCP endpoint or remove the old hosted Edge. The new Gateway must
implement the same `mcp-sync`, `mcp-append`, `mcp-search` and `mcp-read`
contracts and verify the signed MCP delegation, Scope grant, expiration and
revocation rules before a cutover. `mcp-update-pr` is retained as a legacy
handler but is not a public Galaxy Link feature.

Required cutover verification: configure the independent node, deploy the
Authority Worker with `LOC_MANAGED_SQL_GATEWAY_URL`, test MCP search/read,
atomic append and idempotent update, confirm failure/retry behavior, and only
then retire the original vendor endpoint. No database schema, RPC, RLS or
permission change is implied by this transport change.
