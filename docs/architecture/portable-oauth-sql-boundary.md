# LOC Portable — OAuth 授權與 Kysely 直接資料庫連線

2026-11-08 定案：**LOC 永遠不使用 SQL Gateway。**

## 不可違反的架構

- **LOC Auth**：原生 OAuth 2.1／PKCE S256、Session、Scope／Group 權限、
  每位使用者授權選擇資料庫。GitHub／Google／OIDC 只是外部身分適配器。
- **可信任 LOC 應用程式後端**：驗證 OAuth／Scope 授權後，於同一應用程式
  伺服器的 Kysely Driver 執行 SQL，不透過另一個 HTTP SQL 中轉服務。
- **SQL Engine**：PostgreSQL、MySQL、SQL Server 由 Kysely Dialect
  配合各引擎協定 Driver 執行；Supabase／Neon 可以是 PostgreSQL
  伺服器，但不得作為必要的 Auth／Edge／SDK 模組。
- **安全界線**：OAuth token 不等於資料庫密碼；資料庫連線密碼／TLS
  資訊只在可信任伺服器端，Browser、MCP Client、Chrome Extension
  不能取得原始連線密碼。
- **資料獨立**：每個資料庫內容可完全不同，只要求 LOC Schema 對齊；
  不複製、不同步、不集中內容，以 DB ID＋Scope ID 分辨 UID。
- **公開讀取與私有寫入**：匿名仍可讀取原有公開資料；已授權操作必須
  保留八個 Galaxy Boolean、Scope 權限與隱藏內容過濾。
- **永久禁止**：`services/loc-sql`、`services/loc-mcp-sql`、
  泛用 `/v1/sql`、獨立 SQL Gateway Worker／Container、
  Supabase Edge 與任何改名後的等價 SQL 中轉器。

## 正在移除的舊實作

#1248 誤把網站的 `configured.mjs` 和 server numeric reader
改回獨立 Gateway 優先；本次以主分支先前可工作的公開資料來源
恢復，並刪除兩套未部署獨立 SQL 服務和專用 Dockerfile。

舊 `app/loc/gateway/`、`loc-gateway.mjs`、`kysely-edge.mjs`、
Auth／MCP 裡的 Gateway URL 與部署測試，仍需隨原生應用程式後端的
功能移轉同步移除；**不得再從這些舊檔案建立新的 SQL 中轉器**。

網站目前仍有直接公開 Data API 的暫時讀取路線，這不是最終
Kysely Driver 完工狀態。不可先砍斷這個現役公開入口造成 404；
必須先讓可信任 LOC 應用程式後端具備直接 Kysely 查詢能力，
完成公開、私有、MCP、Extension 端到端驗證，再把舊讀取路線刪除。

資料庫 Schema、Table、Column、Index、RLS、Policy、GRANT、RPC、
Migration 仍全面凍結。不新增或變更任何資料庫物件。

進一步的 OAuth、MCP、Extension 以及直接 Driver 切換契約，
見 `docs/architecture/loc-native-portable-final-cutover.md`。
