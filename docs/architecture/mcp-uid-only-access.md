# LOC MCP 權限邊界（Galaxy Link 更新）

LOC MCP 對外以 `galaxy_link` 統一執行私人對話 `search/read/check/record` 與管理者 PR `search/read/update_pr`；Scope 設定與 Group 權限仍分開驗證。

- `galaxy_link.search`：僅使用者／Agent 明確提出接續時才執行；**固定搜尋已授權 Scope 的 `site=mcp`**，不接受來源參數、不查第二次 GitHub。最多 5 筆，具逾時與 Authority QoS；不做背景搜尋、全 Scope 跨表搜尋。
- `galaxy_link.read`：只對指定 Scope 的 `site=mcp` 文章按 UID 分頁讀取；GitHub PR 架構文章亦統一儲存在 `site=mcp`，沿用 `site_id` 辨識來源，`update_pr` 繼續需要 Scope 管理權限。
- `galaxy_link.check`：依來源 `conversation_id` 與 `updated_at` 核對 Durable Object checkpoint，不讀 Galaxy。
- `galaxy_link.record`：只接受提供的來源文字，首次建立隨機八碼 Base62 UID；後續依已知 UID 增量 Append，成功後才更新 checkpoint。
- `read_memory` 保留既有公開文章 UID 讀取；獨立 `update_scope_pr` 工具併入 `galaxy_link(action=update_pr)`，既有後端仍需核對 GitHub 原始來源、原標題 PR 編號或 canonical site_id；`uid` 非必要輸入，由後端在 Scope 授權下依 PR 號尋找唯一既有紀錄，未找到或歧義就拒絕。
- MCP／GitHub PR 八個 Boolean 預設 false；即使日後有錯誤匯入旗標，資料庫 RLS 仍排除匿名讀取，完整八欄可在 Scope 編輯頁個別設定，匯入頁有授權預覽及批次更新。
- Group Search 仍停用；LOC 網站本身的搜尋頁是獨立功能，不受這項變更影響。
- 來源端（瀏覽器／支援的 Agent Client）才有能力取得對話原文；MCP 不會擅自爬取 ChatGPT。每小時排程與瀏覽器補登尚須來源端實作、驗證。
- 部署：Pages Functions、Authority Worker、Kysely Edge 是獨立部署目標；不能因 GitHub 合併就認定正式環境生效。

## MCP 請求上限

- Cloudflare Authority 使用現有 `LOC_AUTHORITY_STATE` Durable Object 計數；不增加資料表、索引或 Worker。
- 每位已驗證 Clerk 使用者最多 16 個 MCP 資料操作／分鐘，跨 Scope 共用額度；全體使用者同時執行最多 16 個 MCP 請求。QoS 限制每位使用者每分鐘最多 12 次讀取、全域最多 12 個同時讀取，保留 4 個名額供寫入使用；寫入可使用其他空閒容量。超額回傳 HTTP 429，不進入 Supabase。
- Galaxy Link 固定 `site=mcp` 搜尋使用獨立限制：每位 Clerk 使用者每分鐘最多 2 次、全域最多 2 次同時搜尋；它同時消耗既有讀取及總請求額度。搜尋逾時 4 秒（管理型 SQL）或 4.5 秒（指定 Scope PostgREST）。
- 公開 UID 讀取也先透過 Authority 取得額度；私有讀寫在 Authority 執行前檢查。未授權及 Group Search 不進資料庫；Galaxy Link 搜尋固定在單一 `site=mcp`；PR 更新仍須 Scope `manage` 授權。
- 額度使用短期租約，正常完成即釋放，意外中斷最多保留 25 秒。計數採原子交易，不能靠 Worker 本機記憶體。
- 如果全域 16 個併發槽位已滿，或 12 個讀取槽位已滿，新增請求立即拒絕，該呼叫者進入 Durable Object 紀錄的冷卻期。每分鐘配額超限（含 Galaxy Link 搜尋每分鐘 2 次）第一次與第二次只回 429；**同一使用者、同一 60 秒窗口內第三次反覆超限**則啟動冷卻。讀取／搜尋／寫入超限次數合併計算，不分 Scope。首次冷卻 3 分鐘；若同一身分在接下來 24 小時內再度觸發，依序延長為 **6、12、24、48、60 分鐘（上限一小時）**；超過 24 小時無新違規事件才重置級數。冷卻期間的重試不延長封鎖，所有 MCP 資料操作回 429，不排隊、不重試。正常 Clerk 登入不受 MCP QoS 影響。拒絕次數、違規級數與冷卻時間均由 Durable Object 交易保存，不因 Worker 重啟消失；**未經驗證的 DDoS 仍需獨立的 Cloudflare WAF／入口限流**。
- **Supabase Data API Max Rows=1000 是單次 SQL REST 回傳的列數限制，不是每分鐘請求數或 MCP 並發數。** 此項為 Supabase 控制台設定，須獨立設定及驗證，不能靠修改 MCP 配額代替。
- 部署必須核對 Cloudflare Pages MCP route、Authority Worker 兩邊版本；GitHub merge 不表示兩邊都已上線。

## Authority QoS 與正式網域（2026-11-04）

- Cloudflare Worker `loc-authority-control` 的正式自訂網域為 `https://auth.lo3rwang.cc`，已核對 Worker Domains。關閉舊 `workers.dev` 公開入口不會停止 Worker。
- Clerk 簽章驗證仍保留；正常登入不占用 MCP 配額。超額 MCP 資料請求回 HTTP 429，不進入 Supabase。
- JWKS 僅快取公開簽章公鑰：in-flight Promise 合併相同並行請求，Cloudflare edge cache TTL 300 秒；不快取憑證、JWT 或身分資料。
- 不因請求經過日本 Cloudflare 節點或來源位於日本而封鎖任何流量。
- 驗收比對 Clerk 子請求增量、MCP 429、正常登入與寫入，以及 Cloudflare Worker 正式部署狀態；累計流量不代表即時流量。
- 測試涵蓋 `scripts/test-mcp-qos.mjs`、`scripts/test-loc-mcp-routing.mjs`；未在連接器中執行 Node 測試時不得宣稱通過。


## MCP 入口 JWKS 去重與 Extension 連線（2026-11-06）

- `app/loc/mcp/router.mjs` 原本只快取單一 isolate 的 Clerk JWKS（並強制 `cache: no-store`）；已改為同 issuer 的 Promise single-flight + 本地最多五分鐘 + Cloudflare Cache API 公開金鑰快取最多五分鐘。只有公開 JWKS 可快取，**每個 MCP 請求仍驗證 JWT 簽章、audience、issuer 與期限**，不快取 JWT 或管理授權。
- Extension 的一次 Scope OAuth 連線核驗依序執行 `loc_connection_status` 和 `galaxy_link.check`；本身不是循環呼叫。Cloudflare 的其他 `identity`、PR 更新、Durable Object RPC 不可全歸因於一次按鍵。
- 增加同一批並行 MCP request 對 Clerk JWKS 的讀取去重測試。正式上線仍需核對 Pages Functions 的部署版本；GitHub 合併不是 Pages 發布證據。

## MCP Session／讀取負載（2026-11-06）

- Clerk OAuth Access Token 是可重複使用的短效憑證。每次呼叫仍需在本地做簽章及期限檢查，但**不必每次呼叫 Clerk 取得公鑰**。Pages 與 Authority Worker 都有短時 JWKS 快取（跨 isolate 的邊緣快取依 Workers Cache 可用性而定）。
- `mcp-read`／`mcp-search` 不再借用 `authorize-write`；Kysely Edge 使用 Authority 的 `authorize-read`。統一 MCP 搜尋要求 `read`，PR 更新獨立要求 `manage`，寫入繼續走 `authorize-write`。
- 同一 Edge isolate 的並行 MCP Token／Scope／動作授權共用一個尚未完成的 Authority 驗證，拒絕時立即失效；不同 Scope 與 read/manage/write 不可共用，不延長 30 秒撤權窗口。
- Kysely Edge 將已驗證的 Scope 授權短時快取 **最多 30 秒**，快取索引是 Token SHA-256 指紋＋Scope＋動作，**不儲存原始 Token**，不快取授權失敗，每次仍透過 Clerk JWKS 本地驗證 JWT。授權撤銷最多可能延遲 30 秒生效。
- Supabase 管理 Edge 沿用既有 root identity 對映；普通 `read` 授權不會被升格成系統管理者寫入憑證。MCP 工具配額／QoS 仍適用。
- Cloudflare Dashboard 的 Clerk host 子請求量代表外連 JWKS 次數（與各時段部署／冷啟動有關），不等於使用者主動打開管理模式，也不等於建立 Session 的次數。要判定實際請求來源需查同時間 Worker trace／request logs。

## 2026-11-06 Galaxy 來源統一

`site=github` 的既有 Galaxy 記錄統一更名為 `site=mcp`，保持原 UID、`site_id`、標題、內容、時間與存取設定。`galaxy_link.search` 不再接受 `source`，Portable PostgREST 固定 `site=eq.mcp`，managed SQL 固定 `WHERE site = 'mcp'`，不對來源使用 bind variable，也不發起第二次 GitHub 搜尋。`update_pr` 透過既有 repo/PR `site_id` 與標題中的 PR 編號確認文章，不建立新文章。原始 GitHub 資料來源仍可由 `site_id` 區別；不另外建索引。
