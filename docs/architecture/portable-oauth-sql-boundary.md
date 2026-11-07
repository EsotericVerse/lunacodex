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

## Browser provider decoupling / frozen Schema (2026-11-07)

- The active browser entry now composes `createLocGatewayAdapter` directly.
  The identity adapter is injectable; Clerk remains the **current compatibility
  identity** until native LOC OAuth exists. This is not a claim that browser
  sign-in no longer requires Clerk.
- A configured independent `NEXT_PUBLIC_LOC_SQL_GATEWAY_URL` does not require
  or forward the legacy Supabase URL/public key. Without an independent URL,
  the existing hosted SQL endpoint remains the compatibility fallback.
- Database backup routing accepts the custom provider for a separately
  configured SQL connection; a working backup is not implied.
- Scope Registry data edits remain available, but `provision_scope` and
  `delete_scope` now reject with HTTP 409. Their earlier PostgreSQL DDL,
  policy creation/deletion and grants have been removed from the active
  Scope admin module to honor the database schema freeze.
- This is source-only decoupling. The active LOC OAuth issuer, independently
  hosted SQL Gateway and production host configuration are not established
  by this commit. No DB DDL, migration, RLS, GRANT or production deployment
  is performed by these source edits.

## Unified public/private SQL Gateway

The browser's public and signed private SQL requests now share
`/functions/v1/loc-kysely` (or the same explicitly configured independent
LOC SQL Gateway URL). The old `loc-kysely-clerk` private-only browser
default was pointing to a stale deployment and could bypass newly shipped
Kysely model/provisioning changes. The trusted OAuth-to-LOC delegation
exchange, public-read budget and account identity adapter are unchanged.
No MCP Authority endpoint or QoS behavior is modified by this browser routing
change.
