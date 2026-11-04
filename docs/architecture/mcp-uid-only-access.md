# LOC MCP 權限邊界（2026-11-04）

LOC MCP 是 UID 定址的文章讀寫介面，**不提供任何搜尋工具或搜尋 API**；網站的搜尋頁是獨立功能，不受此限制。

- 新增對話：`sync_conversation` 以 `scopeid + conversation_id` 作為 Durable Object checkpoint 鍵，保存已生成的 **8 碼隨機 Base62 UID**，後續更新沿用同一 UID，不以文章標題或內容反查。
- 更新 PR：`update_scope_pr` 必須由呼叫者提供已知 UID 及 PR number；只允許更新符合原來源與標題校驗的既有文章。
- 精確讀取：`read_memory` / `read_scope` 依已知 UID 讀取；`check_conversation` 只檢查 checkpoint，不掃描 Galaxy。
- 禁止：`search_memory`、`search_scope`、`search_group`；Cloudflare Authority 的 `/v1/mcp/search/*` 和 `/v1/mcp/group-search/*` 一律拒絕；Kysely Edge 的 `mcp-search` 一律拒絕。
- 對外部署：MCP Router 屬 Pages Functions，Authority Worker 與 Supabase Edge Function 是分開的部署目標；三者須各自核對版本，不能把 main merge 當作全部已上線。
