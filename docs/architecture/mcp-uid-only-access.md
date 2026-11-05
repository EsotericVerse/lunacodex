# LOC MCP 權限邊界（Galaxy Link 更新）

LOC MCP 對外以 `galaxy_link` 統一執行私人對話 `search/read/check/record` 與管理者 PR `search/read/update_pr`；Scope 設定與 Group 權限仍分開驗證。

- `galaxy_link.search`：僅使用者／Agent 明確提出接續時才執行；預設僅搜尋**已授權 Scope 的 `site=mcp`**；指定 `source=github` 則要求額外的 Scope `manage` 權限，最多 5 筆，具逾時與既有 Authority QoS。僅允許 `mcp/github` 兩種來源；不做背景搜尋、全 Scope 跨表搜尋。
- `galaxy_link.read`：預設只對指定 Scope 的 MCP 話題按 UID 分頁讀取；`source=github` 僅 Scope 管理者可讀。
- `galaxy_link.check`：依來源 `conversation_id` 與 `updated_at` 核對 Durable Object checkpoint，不讀 Galaxy。
- `galaxy_link.record`：只接受提供的來源文字，首次建立隨機八碼 Base62 UID；後續依已知 UID 增量 Append，成功後才更新 checkpoint。
- `read_memory` 保留既有公開文章 UID 讀取；獨立 `update_scope_pr` 工具併入 `galaxy_link(action=update_pr)`，既有後端仍需核對 GitHub 原始來源與標題 PR 編號。
- MCP／GitHub PR 八個 Boolean 預設 false；即使日後有錯誤匯入旗標，資料庫 RLS 仍排除匿名讀取，完整八欄可在 Scope 編輯頁個別設定，匯入頁有授權預覽及批次更新。
- Group Search 仍停用；LOC 網站本身的搜尋頁是獨立功能，不受這項變更影響。
- 來源端（瀏覽器／支援的 Agent Client）才有能力取得對話原文；MCP 不會擅自爬取 ChatGPT。每小時排程與瀏覽器補登尚須來源端實作、驗證。
- 部署：Pages Functions、Authority Worker、Kysely Edge 是獨立部署目標；不能因 GitHub 合併就認定正式環境生效。

## MCP 請求上限

- Cloudflare Authority 使用現有 `LOC_AUTHORITY_STATE` Durable Object 計數；不增加資料表、索引或 Worker。
- 每位已驗證 Clerk 使用者最多 16 個 MCP 資料操作／分鐘，跨 Scope 共用額度；全體使用者同時執行最多 16 個 MCP 請求。QoS 限制每位使用者每分鐘最多 12 次讀取、全域最多 12 個同時讀取，保留 4 個名額供寫入使用；寫入可使用其他空閒容量。超額回傳 HTTP 429，不進入 Supabase。
- Galaxy Link 的 `site=mcp` 與私人 `source=github` 搜尋共用獨立限制：每位 Clerk 使用者每分鐘最多 2 次、全域最多 2 次同時搜尋；它同時消耗既有讀取及總請求額度。搜尋逾時 4 秒（管理型 SQL）或 4.5 秒（指定 Scope PostgREST）。
- 公開 UID 讀取也先透過 Authority 取得額度；私有讀寫在 Authority 執行前檢查。未授權及 Group Search 不進資料庫；Galaxy Link 搜尋另需固定來源限制；GitHub 來源必須有 Scope `manage` 授權。
- 額度使用短期租約，正常完成即釋放，意外中斷最多保留 25 秒。計數採原子交易，不能靠 Worker 本機記憶體。
- 如果全域 16 個併發槽位已滿，或 12 個讀取槽位已滿，新增請求立即拒絕，該呼叫者進入 Durable Object 紀錄的 **3 分鐘冷卻期**；冷卻期內持續回 429，不排隊、不重試。單純每分鐘配額耗盡只回 429、不觸發 3 分鐘冷卻；正常 Clerk 登入仍可使用。
- **Supabase Data API Max Rows=1000 是單次 SQL REST 回傳的列數限制，不是每分鐘請求數或 MCP 並發數。** 此項為 Supabase 控制台設定，須獨立設定及驗證，不能靠修改 MCP 配額代替。
- 部署必須核對 Cloudflare Pages MCP route、Authority Worker 兩邊版本；GitHub merge 不表示兩邊都已上線。

## Authority QoS 與正式網域（2026-11-04）

- Cloudflare Worker `loc-authority-control` 的正式自訂網域為 `https://auth.lo3rwang.cc`，已核對 Worker Domains。關閉舊 `workers.dev` 公開入口不會停止 Worker。
- Clerk 簽章驗證仍保留；正常登入不占用 MCP 配額。超額 MCP 資料請求回 HTTP 429，不進入 Supabase。
- JWKS 僅快取公開簽章公鑰：in-flight Promise 合併相同並行請求，Cloudflare edge cache TTL 300 秒；不快取憑證、JWT 或身分資料。
- 不因請求經過日本 Cloudflare 節點或來源位於日本而封鎖任何流量。
- 驗收比對 Clerk 子請求增量、MCP 429、正常登入與寫入，以及 Cloudflare Worker 正式部署狀態；累計流量不代表即時流量。
- 測試涵蓋 `scripts/test-mcp-qos.mjs`、`scripts/test-loc-mcp-routing.mjs`；未在連接器中執行 Node 測試時不得宣稱通過。
