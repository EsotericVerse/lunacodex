## 2026-11-06｜專用 MCP 網域

- 正式 MCP Resource URL 改為 `https://mcp.lo3rwang.cc`，不再要求 MCP Client 把 `/mcp` 附加到 LOC 網站根網域。
- 沿用 Cloudflare Pages `loc` 專案：只在 Host=`mcp.lo3rwang.cc` 時把網站根路由交給 MCP Handler，其他 Host 的首頁仍交給既有網站處理。
- OAuth Protected Resource Metadata 位於 `https://mcp.lo3rwang.cc/.well-known/oauth-protected-resource`；LOC Auth 實際授權伺服器設定由另一路工作負責，本次只變更 MCP canonical resource 與網域路由，不修改 Edge 或資料庫權限。
- Cloudflare Pages Custom Domain、DNS、TLS 啟用狀態與正式 HTTP 請求需分別確認；合併 GitHub PR 不代表 DNS／憑證已啟用。

# LOC MCP 權限邊界（Galaxy Link 更新）

LOC MCP 對外以 `galaxy_link` 執行私人對話 `search/read/check/record`；**PR 搜尋及更新不開放**，GitHub 工作紀錄只能由 GitHub 工具查詢。Scope 設定與 Group 權限仍分開驗證。

- `galaxy_link.search`：**只有使用者本人明確要求搜尋對話時才能呼叫**，傳輸必須帶 `user_requested=true`；Agent 不得自行補查。固定已授權 Scope 的 `site=mcp`，只搜尋內文、最多 5 筆，不接受來源參數；PR／GitHub 版本搜尋一律拒絕，文字為「請至github頁面找尋PR相關資料！不開放搜尋PR!」，不附連結。
- `galaxy_link.read`：只對指定 Scope 的 `site=mcp` 對話文章按 UID 分頁讀取；不提供以 PR 為目的的搜尋或 PR 更新入口。
- `galaxy_link.check`：依來源 `conversation_id` 與 `updated_at` 核對 Durable Object checkpoint，不讀 Galaxy。
- `galaxy_link.record`：只接受提供的來源文字，首次建立隨機八碼 Base62 UID；後續依已知 UID 增量 Append，成功後才更新 checkpoint。
- `read_memory` 只保留既有公開文章 UID 讀取；`update_scope_pr`、`galaxy_link(action=update_pr)` 與 PR 搜尋不再開放，遇到 PR 查詢即提示使用 github頁面。
- MCP／GitHub PR 八個 Boolean 預設 false；即使日後有錯誤匯入旗標，資料庫 RLS 仍排除匿名讀取，完整八欄可在 Scope 編輯頁個別設定，匯入頁有授權預覽及批次更新。
- Group Search 仍停用；LOC 網站本身的搜尋頁是獨立功能，不受這項變更影響。
- 來源端（瀏覽器／支援的 Agent Client）才有能力取得對話原文；MCP 不會擅自爬取 ChatGPT。每小時排程與瀏覽器補登尚須來源端實作、驗證。
- 部署：Pages Functions、Authority Worker、Kysely Edge 是獨立部署目標；不能因 GitHub 合併就認定正式環境生效。

## MCP 請求上限

- Cloudflare Authority 使用現有 `LOC_AUTHORITY_STATE` Durable Object 計數；不增加資料表、索引或 Worker。
- 每位已驗證 Clerk 使用者最多 16 個 MCP 資料操作／分鐘，跨 Scope 共用額度；全體使用者同時執行最多 16 個 MCP 請求。QoS 限制每位使用者每分鐘最多 12 次讀取、全域最多 12 個同時讀取，保留 4 個名額供寫入使用；寫入可使用其他空閒容量。超額回傳 HTTP 429，不進入 Supabase。
- Galaxy Link 固定 `site=mcp` 搜尋使用獨立限制：每位 Clerk 使用者每分鐘最多 2 次、全域最多 2 次同時搜尋；它同時消耗既有讀取及總請求額度。搜尋逾時 4 秒（管理型 SQL）或 4.5 秒（指定 Scope PostgREST）。
- 公開 UID 讀取也先透過 Authority 取得額度；私有讀寫在 Authority 執行前檢查。未授權及 Group Search 不進資料庫；Galaxy Link 搜尋固定在單一 `site=mcp`，禁止 PR 搜尋。QoS 距離限制剩一次時會預警；PR 拒絕與 QoS 預警同時成立時，回應同時顯示兩行。唯讀 QoS 狀態檢查不消耗搜尋額度。
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
- 舊 Extension 曾透過 MCP 核對連線；新版獨立 MV3 Extension 不共用 MCP Session 或 Queue，透過 LOC 網站寫入橋接授權，不應將新 Extension 的錄製或 Queue 計為 MCP 搜尋。
- 增加同一批並行 MCP request 對 Clerk JWKS 的讀取去重測試。正式上線仍需核對 Pages Functions 的部署版本；GitHub 合併不是 Pages 發布證據。

## MCP Session／讀取負載（2026-11-06）

- Clerk OAuth Access Token 是可重複使用的短效憑證。每次呼叫仍需在本地做簽章及期限檢查，但**不必每次呼叫 Clerk 取得公鑰**。Pages 與 Authority Worker 都有短時 JWKS 快取（跨 isolate 的邊緣快取依 Workers Cache 可用性而定）。
- `mcp-read`／`mcp-search` 不再借用 `authorize-write`；Kysely Edge 使用 Authority 的 `authorize-read`。MCP 搜尋要求有效 `read` 授權、使用者明確請求與 QoS 許可；PR 搜尋與更新已停用。
- 同一 Edge isolate 的並行 MCP Token／Scope／動作授權共用一個尚未完成的 Authority 驗證，拒絕時立即失效；不同 Scope 與 read/manage/write 不可共用，不延長 30 秒撤權窗口。
- Kysely Edge 將已驗證的 Scope 授權短時快取 **最多 30 秒**，快取索引是 Token SHA-256 指紋＋Scope＋動作，**不儲存原始 Token**，不快取授權失敗，每次仍透過 Clerk JWKS 本地驗證 JWT。授權撤銷最多可能延遲 30 秒生效。
- Supabase 管理 Edge 沿用既有 root identity 對映；普通 `read` 授權不會被升格成系統管理者寫入憑證。MCP 工具配額／QoS 仍適用。
- Cloudflare Dashboard 的 Clerk host 子請求量代表外連 JWKS 次數（與各時段部署／冷啟動有關），不等於使用者主動打開管理模式，也不等於建立 Session 的次數。要判定實際請求來源需查同時間 Worker trace／request logs。

## 2026-11-06 Galaxy 來源統一

`site=github` 的既有 Galaxy 記錄曾統一更名為 `site=mcp`，保留原 UID、`site_id`、標題、內容、時間與存取設定。這是歷史資料調整，**不代表目前 MCP 可以搜尋 PR**；`galaxy_link.search` 僅接受明確使用者請求，固定 `site=mcp` 並拒絕 PR 文字，也不再提供 `update_pr`。原始 GitHub 資料來源仍由 `site_id` 辨別；不新增索引。

## 2026-11-06 Extension 連線探測排除 Scope DO 不穩定

Cloudflare Workers Observability 實際紀錄：`2026-11-06 01:26 UTC` 的 `GET /v1/mcp/galaxy-link/checkpoint/lo3rwang/loc-galaxy-extension-connection-probe` 因 `Network connection lost` 回 HTTP 500，對應 `LocAuthorityState.mcpCheckpoint` Durable Object RPC 遭取消；同一條路徑稍早有 HTTP 200 成功紀錄。此失敗發生於 Extension 的初次寫入權限核驗，尚未進入 Supabase SQL。

對固定的 `loc-galaxy-extension-connection-probe`，LOC Authority **先照常執行 Clerk + Scope `write` 授權**；授權通過後直接回覆符合 `galaxy_link.check` 形狀的非持久化 checkpoint，避免為無實際文章的連線探測讀取 Scope Durable Object。其他 conversation ID 的 `galaxy_link.check`、正式寫入及去重 checkpoint 完全沿用原 Durable Object。未變更 Clerk、Root、QoS、SQL、前端 Extension 版本。
