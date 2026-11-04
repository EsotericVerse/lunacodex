# LOC MCP 權限邊界（2026-11-04）

LOC MCP 是 UID 定址的文章讀寫介面，**不提供任何搜尋工具或搜尋 API**；網站的搜尋頁是獨立功能，不受此限制。

- 新增對話：`sync_conversation` 以 `scopeid + conversation_id` 作為 Durable Object checkpoint 鍵，保存已生成的 **8 碼隨機 Base62 UID**，後續更新沿用同一 UID，不以文章標題或內容反查。
- 更新 PR：`update_scope_pr` 必須由呼叫者提供已知 UID 及 PR number；只允許更新符合原來源與標題校驗的既有文章。
- 精確讀取：`read_memory` / `read_scope` 依已知 UID 讀取；`check_conversation` 只檢查 checkpoint，不掃描 Galaxy。
- 禁止：`search_memory`、`search_scope`、`search_group`；Cloudflare Authority 的 `/v1/mcp/search/*` 和 `/v1/mcp/group-search/*` 一律拒絕；Kysely Edge 的 `mcp-search` 一律拒絕。
- 對外部署：MCP Router 屬 Pages Functions，Authority Worker 與 Supabase Edge Function 是分開的部署目標；三者須各自核對版本，不能把 main merge 當作全部已上線。

## MCP 請求上限

- Cloudflare Authority 使用現有 `LOC_AUTHORITY_STATE` Durable Object 計數；不增加資料表、索引或 Worker。
- 每位已驗證 Clerk 使用者最多 64 個 MCP 資料操作／分鐘，跨 Scope 共用額度；全體使用者同時執行最多 64 個 MCP 請求。QoS 限制每位使用者每分鐘最多 48 次讀取、全域最多 48 個同時讀取，保留 16 個名額供寫入使用；寫入可使用其他空閒容量。超額回傳 HTTP 429，不進入 Supabase。
- 公開 UID 讀取也先透過 Authority 取得額度；私有讀寫在 Authority 執行前檢查。未授權及已停用的搜尋端點不進資料庫。
- 額度使用短期租約，正常完成即釋放，意外中斷最多保留 25 秒。計數採原子交易，不能靠 Worker 本機記憶體。
- **Supabase Data API Max Rows=1000 是單次 SQL REST 回傳的列數限制，不是每分鐘請求數或 MCP 並發數。** 此項為 Supabase 控制台設定，須獨立設定及驗證，不能靠修改 MCP 配額代替。
- 部署必須核對 Cloudflare Pages MCP route、Authority Worker 兩邊版本；GitHub merge 不表示兩邊都已上線。

## Authority QoS 與正式網域（2026-11-04）

- Cloudflare Worker `loc-authority-control` 的正式自訂網域為 `https://auth.lo3rwang.cc`，已核對 Worker Domains。關閉舊 `workers.dev` 公開入口不會停止 Worker。
- Clerk 簽章驗證仍保留；正常登入不占用 MCP 配額。超額 MCP 資料請求回 HTTP 429，不進入 Supabase。
- JWKS 僅快取公開簽章公鑰：in-flight Promise 合併相同並行請求，Cloudflare edge cache TTL 300 秒；不快取憑證、JWT 或身分資料。
- 不因請求經過日本 Cloudflare 節點或來源位於日本而封鎖任何流量。
- 驗收比對 Clerk 子請求增量、MCP 429、正常登入與寫入，以及 Cloudflare Worker 正式部署狀態；累計流量不代表即時流量。
- 測試涵蓋 `scripts/test-mcp-qos.mjs`、`scripts/test-loc-mcp-routing.mjs`；未在連接器中執行 Node 測試時不得宣稱通過。
