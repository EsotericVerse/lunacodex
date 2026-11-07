# LOC Agent 執行規範（精簡版）

## Galaxy 搜尋與 GitHub PR 最新規則（優先於下方歷史流程）
- **不得為了 PR、Commit、Diff、Branch 或例行任務而搜尋 Galaxy UID**；GitHub 原始紀錄由 GitHub 工具直接查詢。`galaxy_link.update_pr` 退役，PR 不再另建 Galaxy 副本或更新同篇 UID。
- `galaxy_link.search` **僅在使用者明確要求搜尋歷史 Galaxy 對話時使用**；不可新對話自動查、不自行換詞連查。已知 UID 用 `read`、已知 conversation_id 用 `check`，對話記錄用 `record`。
- 服務端按已驗證委託身分記錄搜尋次數，每五分鐘最多接受一次搜尋；被拒絕的重試先收到提醒，再交由現有 QoS 流量管制處理；拒絕不延長原五分鐘起算時間。
- 本段取代下方任何要求「PR 先寫 Galaxy、補 UID、合併後更新 Galaxy」及「新工作先搜尋 Galaxy」的舊規則。

## 核心邊界
- 使用者決定「需求」及「需自行觸發的計費／正式發布時機」；Agent 自行負責程式、驗證、衝突、PR、Galaxy 與清理。不要要求使用者看 code、diff、commit log 或解決技術問題。
- **預設持續執行直到完成**。已授權的需求持續完成；需求牽動其他功能或有具體取捨時，說明影響、依據與建議，再處理真正待決的部分。一般錯誤、工具失敗、驗證、衝突、PR、Galaxy 更新與收尾自行排除並續作；只在使用者明確叫停、真正需要新的業務／Schema 授權、或本人保留的高計費正式操作時停下對應動作，其他部分繼續。**執行過程預設不逐步印字、不逐 PR 解說、不反覆發進度通知；只有真正需要使用者配合、重大不可逆風險、實際阻礙或最後交付結果，才以最少必要文字回報。**不把技能（superpowers／ponytail）的內部流程或日誌轉貼給使用者；需要執行技能時由 Agent 自行在工具中處理，不因插件流程要求使用者反覆回覆。
- **使用者已授權 GitHub Pages 在 `main` push 後自動部署**；正式部署由單次完整合併觸發，Agent 不額外手動執行 `workflow_dispatch`。公開 RC／iOS 打包與其他高計費手動工作流程仍由使用者決定。Cloudflare Pages 的 `main` 自動部署照既有設定運作，兩者須分開確認。
- **GitHub 管理權限硬邊界**：分支清理、PR 或程式修復的授權不包含進入 GitHub Settings（包含 Branches／Rulesets／Branch protection／Required checks／Actions 管理權限）或嘗試更動儲存庫權限、所有權、部署設定；未獲使用者針對該管理操作明確授權，連進入相關設定介面執行管理工作都禁止。不得要求使用者盲目通過手機雙重認證。必要時只提供要修改的具體項目與風險，由使用者決定是否親自操作。

## 唯一正常工作流程
**需求 → 沿用／建立一個工作 Branch → 修改與必要文件完成 → 功能驗證 → 開一個 GitHub PR → 確認可合併 → Merge → 分別核對 Merge、部署與實際功能 → 刪除已合併 Branch。**

- **連續交付、無人為等待點**：需求已明確且獲授權時，解說完就直接動工；每階段的結果經實際確認後，自行推進下一階段，不需要使用者重複輸入「做、PR、Merge、補文件、繼續」。不可將說明、改完程式、開 PR、測試通過、Merge 或部署觸發任一單項視為全部完成。文件必須和相關程式一起完成；PR 可合併且必要驗證通過時立即合併。遇權限或安全阻礙，記錄可驗證原因並繼續其他合法且不受影響工作；只有確實需要使用者的決策／操作時，才提出具體需配合點。**等待不是預設工作狀態；等待必須有外部阻礙與證據。**
- **結案證據**：依工作性質確認需求效果、必要功能／回歸測試、PR 號與合併 SHA、實際部署（如適用）、必要文件與 Branch 收尾。若外部部署尚未完成或不能驗證，誠實標為待驗證，不可宣稱已上線；無須為純文件 PR 虛構功能測試。

1. **一項完整功能修改只開一次 PR，不得改一片、開一個 PR**；先把相關程式、UI、測試、文件及修復集中完成，再送單一 PR。**同一功能的既有進行中 Branch 能沿用就沿用**，在其上追加相關修改；已合併的舊 Branch 不強求重用。不要為每個檔案、步驟、小錯誤或回合另開 Branch／PR。原則上單一 PR 不超過 20 個檔案；若完整功能確需更多檔案，先精簡範圍並依實際合併限制處理，不為湊檔案數而把同一功能拆成多次部署。完成必要驗收後即送出 PR 並及時 Merge；尚未完成者留在工作 Branch 繼續修，不開半成品 PR，也不為等待其他工作或累積進度而扣住已完成的 PR；`main` 自動部署已恢復，合併會觸發部署，須避免瑣碎 PR，但不得因此拖延已完成工作。只有互不依賴、無法合理合批的需求才分開。改完才開 PR，不用草稿 PR 佔位。
2. 修改只在隔離工作區與工作分支進行；動工前留可取回的 Git SHA／checkpoint，重要且完整的階段再留還原點。不碰別人的未提交修改，不直接推半成品到 `main`。
3. 同一使用者可同時指揮 2–8 個以上 Agent，回覆可能簡短、快速切換脈絡；按各任務、最新明確指示與實際程式狀態判斷，不把不同情境的「可以／不行」當成全域命令。多 Agent 避免同時修改相同檔案／模組；遇到範圍重疊，先核對最新提交並協調順序，繼續不衝突的部分，不無期限被動等待。工作期間有 `main` 更新就適時同步；**開 PR 前先確認需求真正完成、既有功能與視覺未退化、必要的功能／回歸驗證，以及與最新 `main` 的衝突**；不得以程式簡化、測試通過或 Merge 成功替代需求驗收。不要等 Merge 失敗才補救。**不得長期扣住已完成的 PR**：其他 Agent 持續改動會增加衝突、使修改被覆寫／改回，甚至導致無法完整 Merge 與成倍重工；請先整合當前 `main`、排除衝突並及時合併，不以囤積 PR 當作風險控管。開 PR 後若 `main` 又變動，合併前再核對一次；技術衝突由 Agent 解決。
4. PR 直接使用 GitHub 原生討論、Commit 與 Diff 保存交接紀錄；不建立 Galaxy PR 副本，不搜尋或記憶 PR 專用 UID。合併後核對 SHA、必要部署和功能，再清理已合併 Branch。受影響的必要技術／使用／版本文件在同一工作內更新。
5. Merge、GitHub Actions 通過、GitHub Pages／Cloudflare 實際部署是不同狀態，分別記錄。GitHub Pages 與 Cloudflare Pages 均在 `main` push 後按各自機制自動部署，preview branch 保持停用；獨立 Workers／Edge Functions 須個別確認。除非使用者另有明確指示，不得因 PR 建立、測試或重跑而手動觸發正式部署。

## 唯一異常處理
- **只有使用者針對目前任務明確中斷、要求暫停或否定方向**：停止該方向的修改 → 可逆地回到最近一個「正確且完整」的 checkpoint → 保留恢復依據 → 等待新的方向。此例外不適用於 Agent 自己發現的錯誤：自行修復並繼續，不得把偵測到異常解讀為使用者要求中斷。不碰其他 Agent 的修改；若同檔案混合他人工作，只精準撤銷自己的部分。
- **無法證實中斷後已完整還原**：只暫停將不確定的程式送進 PR／`main`，由 Agent 自行核對還原點、必要時執行獨立語法檢查並排除殘缺；恢復完整就依原任務繼續，除非使用者先前明確要求停等。不能把「有 checkpoint」當成「一定已還原」。
- **正常完成、可證實沒有中斷，或已完整還原並有證據**：不為了防中斷而額外執行全專案語法掃描；對功能改動仍做必要、針對性的功能／回歸驗證；純文件變動不跑完整功能測試。不能把語法檢查通過當成功能完整的證據。語法錯誤與 Git Merge 衝突分開處理，兩者都應在 Merge 前排除。
- `.githooks/pre-push` 正常推送只執行大量刪除／重新命名安全檢查，不再每次掃全專案語法。**僅在意外中斷、修改殘缺、還原不確定或實際出現語法錯誤時**，由 Agent 核對 checkpoint 並執行 `npm run check:syntax`；若 Connector 沒有 npm 環境，可使用 GitHub Actions 的 **Workflow guard → Run workflow** 手動執行一次恢復檢查，不能宣稱未執行的檢查已通過。不得僅憑 `LOC_EDIT_STATE=complete` 旗標認定修復完成。GitHub `workflow-guard.yml` 自動執行只限變更 `.github/workflows/**` 的 PR，僅檢查 Workflow 觸發政策；其他 PR 不自動跑全專案語法或匯入測試。GitHub Pages 自動部署只依賴必要的安全稽核、遊戲回歸、Next.js build 與靜態輸出驗證；**不額外跑獨立的全專案 `check:syntax`**，因為 build 本身會解析其編譯範圍；這不表示未被 build 涵蓋的全部檔案已通過語法掃描。中斷恢復的手動 `Workflow guard → Run workflow` 才做額外全專案語法檢查，需核對實際 Actions 執行結果，不可只以 workflow 存在當作驗收成功。不能用本規則繞過發布安全檢查；不在 Settings 新增 Required Check。
- **語法檢查的結果處置**：需檢查時先確認實際執行證據與結果；通過才推進，失敗自行修復並重驗，未執行必須標為「未驗證」。沒有 npm 執行環境才改採已授權且適用的遠端檢查；不得因檢查排程／工具等待而無限停住其他可執行部分，亦不得以未驗證充當通過。無意外中斷的正常編修維持既定針對性驗證，不新增每次全專案語法檢查。
- 同一測試已有可信的未受影響結果就不重複付費跑；必要檢查需有實際執行結果，不靠文字宣稱通過。測試／合併失敗即自行排查，不重複無效操作；同一 workflow 連續失敗三次僅停止該 workflow 的重試，改查原因或用其他合法途徑完成任務，不得把整項工作轉成被動等待。

## Galaxy 與文件
- Galaxy 保留確有必要的對話、作品與架構內容；GitHub 原生保存 PR、Commit、Diff 與版本交接，禁止為此另建 Galaxy PR 副本。寫入 Galaxy 後核對回傳；失敗明確標「未儲存成功」。
- `site` 表示真實內容來源，禁止為便於搜尋而偽改；歷史 `site=github` PR 資料只保留既有紀錄，不再新增、搜尋或更新。新建 Galaxy 八碼 UID 由標準安全亂數 Base62 產生器提供，不得猜測或自行編造。只有使用者明確要求搜尋歷史對話時，才可呼叫 `galaxy_link.search`。
- LOC MCP 只用於已授權的對話 `check/read/record` 與明確要求的歷史對話 `search`；PR 相關操作請直接使用 GitHub。
- Galaxy 文章公開權限採八個獨立 boolean 欄位：`statics`、`culture`、`search`、`trace`、`list`、`keyword`、`extract`、`others`。Galaxy 禁止新增任何 JSONB 欄位；PostgreSQL（含 Portable）的 `target_id`、`media_link` 分別採 `text[]`、`varchar[]`，僅 Anchor 的 `attr` 使用 JSONB。不得再讀寫已退役的 `galaxy.able`；一般私有紀錄 `list=false`，既存 PR 歷史資料不再透過 MCP 更動。歷史匯入轉換不算直接讀寫資料庫舊欄。
- 歌曲與專輯等作品紀錄須保存來源實際全文，不能用摘要冒充全文。

## 資料庫／安全硬邊界
- **永久架構禁止：LOC 不得使用 SQL Gateway。** 不得新建、復活、改名或部署 `loc-sql`、`loc-mcp-sql`、泛用 `/v1/sql` HTTP Query 轉送器、獨立 SQL Gateway Container／Worker／Edge；不得把這些服務作為 Portable、MCP、Extension、LOC Auth 的依賴。資料庫 SQL 只由 LOC 可信任應用程式後端透過 Kysely Driver 與對應 Dialect 執行；LOC Auth 僅負責 OAuth 身分、Scope 權限和資料庫選擇，不替代 SQL Driver 登入。不得使用 Supabase Edge、Supabase／Neon／Clerk SDK 作為此架構的必要模組。網站瀏覽器不得取得資料庫連線密碼。清理期間禁止重建任何同等功能的 Gateway 來迴避此條禁令。
- **2026-11-07 起資料庫全面凍結（最高優先）**：除使用者明確解除凍結外，所有 Agent 禁止修改或執行資料庫 Schema、Table、Column、Index、Trigger、RPC、Migration、RLS、Policy、GRANT／REVOKE、CREATE／ALTER／DROP；此限制包括 Portable 的新 Scope 建表、跨庫安裝器、自動修復和所有部署腳本。僅允許既有資料表中的 SELECT、INSERT、UPDATE、DELETE。程式不得偷偷在首次連線／管理操作時執行 DDL。既有 SQL Session 相容操作不得用來改寫 RLS。
- **Portable 直接 Driver**：資料庫連線憑證只留在可信任 LOC 應用程式後端 Secret／Bindings；使用伺服器端別名與 Kysely Dialect 選擇 SQL Engine，LOC Auth 處理 OAuth／權限／資料庫選擇，絕不使用獨立 SQL Gateway。Clerk、Supabase、Neon 不得是跨庫 SQL 的必要身分相依。正式網站尚有公開 Data API 過渡讀取，新的直接 Driver 業務路徑完成驗證前不得擅自切斷，亦不得假稱已完成全部替換。
- **公開 Theme 不查資料庫**：`silver.loc.theme` 僅供已授權 Admin 管理；公開前台固定使用 `app/modular/published-theme-catalog.json` 與 `published-themes.css`。管理員儲存後須明確執行 `sync:public`、提交發布產物再由既有流程部署；不可在頁面載入或 Theme 儲存後自動重新 SELECT `silver.loc.theme`，也不可為此更動 RLS。
- **公開讀取與權限不可擅改**：使用者已明確要求 LOC 公開頁面資料可正常 SELECT。未經針對本次任務的明確授權，禁止修改 RLS Policy、GRANT／REVOKE 或以「安全考量」阻擋既有公開讀取；修復查詢頻率、Footer、Session 與 UI 不構成修改資料庫權限的授權。公開功能必須驗證未登入、沒有既有 Service Worker 快取的新訪客可載入；開發者本機快取成功不等於公開功能驗收成功。既有 Service Worker 不得因快取問題被擅自停用。
- **UID 硬性規格**：涉及 Galaxy、Anchor 及其他既定八碼 UID 的新增流程，一律使用現有標準 Base62 安全亂數產生器；不得用標題、日期、PR 號、Scope 名稱或人造字串湊八碼。若尚無共用產生器，先查現有寫入入口，於其最小共用位置補齊，不另外新增資料表或索引。
- 未獲授權不得新增資料表、欄位、索引、觸發器、RPC 或修改既有 Schema；確有必要先用白話說明 SQL DDL、效能與空間影響。使用者已明確指定的變更即為授權，不反覆詢問。
- 禁止把應可供 `WHERE／JOIN／ORDER BY` 的新結構化資訊偷偷改塞新的 JSONB key 來規避 Schema 審查；新 key 若需查詢／關聯／排序或無法判定，先依上述方式取得授權。遵守既定 Scope、UID、Clerk 權限與資料可攜性，不擅自雙寫或更換主庫。
- 如使用 superpowers、ponytail 等已安裝技能，必須實際執行相應流程，不可只宣稱已使用。除必要決策或真正缺權限外，Agent 自行解決技術問題；卡關只提出使用者能操作的具體配合事項。

## 接手與完成
- 先核對目前 GitHub main 與相關 PR；使用者提供已知 Galaxy UID 時才依授權精確讀取。不得自行搜尋 Galaxy 找架構圖或 PR UID；私人架構不得複製至公開 repo／PR。
- 話題轉移仍保留原需求；由 GitHub Branch、Commit 與 PR 承接工作進度。新對話核對 GitHub，不為了交接而自行搜尋 Galaxy 或建立 UID。
- 合併前後按原需求核對成果，整合雙方修改；保留已完成功能與依賴升級，不以退回舊程式換取 merge 成功。需要使用者的新授權只暫停對應部分，其餘繼續。

## 跨對話／插件一致性
- **Plugins／Skills 主動發現、實讀、執行**：LOC 任務每次開始先讀取目前儲存庫的 `AGENTS.md` 與相關任務狀態；主動檢索本次可用且與需求相關的已安裝 Plugins／Skills，實際讀取所選 Plugin 的入口 Skill、所需關聯 Skill 與必要參考文件，再依內容執行。**不能只看 Plugin 名稱、僅宣稱有使用、或等使用者逐一點名才讀取**；不得要求使用者每回合重新貼 Plugins／Skills 名單。不因某工具在新對話未啟用就降低連續交付、驗證、PR、Galaxy 或 Merge 標準。
- **實際能力邊界**：已安裝不等於本次工具可用；技能指示不能代替工具實際執行，也不能保證跨對話自動載入。技能不可用時沿用本文件可執行的標準工作流程，不假稱已調用；不為了插件的內部流程而製造額外 Branch、PR、Workflow、文件或人工確認點。介面／UX 類技能只在相關需求適用，不強制所有純技術任務跑設計流程。

## Skill 路由入口
- 從任務目的主動選用已安裝 Plugin／Skill，讀取指引後實際執行；同一能力選一份，不等待使用者點名。
- 詳細任務對照見 [docs/agent-skill-routing.md](docs/agent-skill-routing.md)，只讀本次相關段落，避免每次預載整張表。
- SQL／資料存取 → [LOC Kysely 官方文件工作流程](.github/skills/kysely-portable-loc/SKILL.md)、[Kysely](.agents/skills/kysely/SKILL.md)；ZModel／ORM／權限 → [ZenStack V3 Querying](.agents/skills/zenstack-querying/SKILL.md)、[ZenStack V3 Access Control](.agents/skills/zenstack-access-control/SKILL.md)；Auth／登入／Session → `workers/loc-authority/native-oauth.mjs` 與 `app/loc/auth/loc-browser.mjs`。SQL 沿用 Kysely 統合路徑，不恢復舊託管 Auth SDK。
- 專業能力不足時讀 [find-skills](.agents/skills/find-skills/SKILL.md)，到 [skills.sh](https://skills.sh/) 查找，核對來源、適用版本與技能原文；查證目前版本及新版能力後再判斷支援程度，由 Agent 接續解決與驗證。
- LOC 需求完成流程優先查用已安裝的 `loc-finish-request`；不可用時依本文件及 repo 路由繼續，不把私人技能當成所有 Agent 都有的 repo 檔案。
- Codex／Claude 分別使用可讀取的 `.agents/skills/`、`.claude/skills/` 或已安裝 Plugins；保留其他 Agent 需要的發現入口。

## 工作流程與費用
- `.github/workflows/workflow-guard.yml` 只在 Workflow 檔案修改的 PR 自動檢查觸發政策，亦可手動執行中斷恢復語法檢查；**唯一正式自動部署例外**是使用者已授權 `.github/workflows/deploy-pages.yml` 在 `main` push 後執行。其他 Workflow 預設只能 `workflow_dispatch`，不可自行加入自動觸發。Guard 不得變成額外的全專案自動語法檢查。
- 不在多個 workflow 重複執行同一組昂貴測試；正式、昂貴步驟的必要前置驗證以最低成本處理。GitHub Pages 已由 `main` 自動部署，不要另行手動觸發相同部署；公開 RC release 或高計費打包仍需使用者明確要求。
- 完成後只用白話交付：**需求是否達成、原功能是否正常、真正需要使用者配合的事項（如有）**；已完成的工作不持續重複回報。
