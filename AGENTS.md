# LOC Agent 執行規範（精簡版）

## 核心邊界
- 使用者決定「需求」及「需自行觸發的計費／正式發布時機」；Agent 自行負責程式、驗證、衝突、PR、Galaxy 與清理。不要要求使用者看 code、diff、commit log 或解決技術問題。
- 以使用者當下明確需求為準；不要為已確定的事情反覆確認、腦力激盪或拆出額外工作。必要的範圍外修改先用白話說明並取得同意。回報結果與真正卡點，不洗版、不宣稱未完成的事情已完成。
- GitHub Pages 與 Cloudflare Pages 均在 `main` push 後按既有設定自動部署；Agent 不手動觸發正式部署。公開發布與明顯高計費的手動工作流程仍由使用者決定觸發。

## 唯一正常工作流程
**需求 → 沿用／建立一個工作 Branch → 修改完成 → 開一個 PR → 確認可合併 → Merge → 刪除已合併 Branch。**

1. 同一需求原則上一個 Branch、一個 PR；優先沿用既有工作分支。不為了分批回報、測試或中斷而增加分支／PR。只有真正互不依賴的需求才分開。改完才開 PR，不用草稿 PR 佔位。
2. 修改只在隔離工作區與工作分支進行；動工前留可取回的 Git SHA／checkpoint，重要且完整的階段再留還原點。不碰別人的未提交修改，不直接推半成品到 `main`。
3. 多 Agent 要避免同時修改相同檔案／模組；範圍重疊的後進者先等前者完成並 Merge。工作期間有 `main` 更新就適時同步；**開 PR 前先確認工作完整、必要的功能／回歸驗證、及與最新 `main` 的衝突**。不要等 Merge 失敗才補救。開 PR 後若 `main` 又變動，合併前再核對一次；技術衝突由 Agent 解決。
4. PR、Commit、Diff 直接以 GitHub 原生紀錄保存交接，不另建 Galaxy PR 副本。Merge 成功後核對合併 SHA 與部署，再刪除來源 Branch；分支刪除失敗不得宣稱結案。受影響的必要技術／使用／版本文件在同一工作內更新，不另立進度流水帳。
5. Merge、GitHub Actions 通過、實際部署是不同狀態，分別記錄。GitHub Pages 與 Cloudflare Pages 均於 `main` push 後各自自動部署，preview branch 保持停用；獨立 Workers／Edge Functions 須個別確認。不得因 PR 建立、測試或重跑而手動觸發正式部署。

## 唯一異常處理
- **被使用者中斷或方向被否定**：立即停手 → 可逆地回到最近一個「正確且完整」的 checkpoint → 保留恢復依據 → **停止等待使用者下一步**。不繼續加工錯誤方向、不急著送 PR、不另開分支、不碰其他 Agent 的修改。若同檔案混合其他人的工作，只精準撤銷自己的修改。
- **無法證實中斷後已完整還原**：視為不確定狀態，保留獨立語法檢查並排除殘缺，不讓半成品進 PR／`main`。不能把「有 checkpoint」當成「一定已還原」。
- **正常執行且能確認未中斷，或已完整回復且有依據**：不另外重跑獨立語法檢查。功能變動仍做必要、針對性的功能／回歸驗證；純文件變動不測程式。語法錯誤與 Git Merge 衝突分開處理，兩者都應在 Merge 前排除。
- 本機 `.githooks/pre-push` 正常推送只執行大量刪除／重新命名的安全檢查，不每次掃全專案語法；**只有在意外中斷、修改殘缺或實際出現語法錯誤時**才執行 `npm run check:syntax` 並排除殘缺。不得僅憑旗標認定修復完成。
- 同一測試已有可信的未受影響結果就不重複付費跑；必要檢查需有實際執行結果，不靠文字宣稱通過。測試／合併失敗先排查原因，同一任務同一 workflow 連續失敗三次即停止無意義重試並簡要告知。

## Galaxy 與文件
- Galaxy 保留確有必要的需求、架構決策與作品紀錄；PR、Commit、Diff、AGENTS.md 及版本說明由 GitHub 原生保存，不另建重複進度表或 Galaxy PR 副本。寫入 Galaxy 後核對回傳，能讀回時讀回；失敗明確標「未儲存成功」，不得冒稱已寫入。
- `site` 代表真正來源，禁止為便於搜尋而偽改；歷史 `site=github` PR 資料只保留既有紀錄，不再新增或更新。Galaxy UID 八字元、大小寫保留，不擅自公開私有架構或對話。
- 優先用 LOC MCP；必要且有授權時使用現行主庫的可用正式入口，不雙寫、不擅自切換備援。PR 相關操作一律改用 GitHub，不再經 Galaxy PR 工具。
- 不能把未驗證的部署寫成已上線。歌曲與專輯等作品紀錄須保存實際全文，不能用摘要冒充全文。

## 資料庫／安全硬邊界
- 未獲授權不得新增資料表、欄位、索引、觸發器、RPC 或修改既有 Schema；確有必要先用白話說明 SQL DDL、效能與空間影響。使用者已明確指定的變更即為授權，不反覆詢問。
- 禁止把應可供 `WHERE／JOIN／ORDER BY` 的新結構化資訊偷偷改塞新的 JSONB key 來規避 Schema 審查；新 key 若需查詢／關聯／排序或無法判定，先依上述方式取得授權。遵守既定 Scope、UID、Clerk 權限與資料可攜性，不擅自雙寫或更換主庫。
- 如使用 superpowers、ponytail 等已安裝技能，必須實際執行相應流程，不可只宣稱已使用。除必要決策或真正缺權限外，Agent 自行解決技術問題；卡關只提出使用者能操作的具體配合事項。

## 工作流程與費用
- `.github/workflows/workflow-guard.yml` 只在改 Workflow 檔案的 PR 自動檢查觸發政策；唯一正式自動部署例外是已授權的 `deploy-pages.yml`（`main` push 後）。其他工作流程預設僅能 `workflow_dispatch`，未獲同意不能加入自動觸發。
- 不在多個 workflow 重複執行同一組昂貴測試；正式、昂貴步驟的必要前置驗證以最低成本處理。GitHub Pages 已由 `main` 自動部署，不另行手動觸發；公開 release 或高計費打包仍需使用者明確要求。
- 完成後只用白話交付：**需求是否達成、原功能是否正常、真正需要使用者配合的事項（如有）**；已完成的工作不持續重複回報。

## Database & ORM Constraints
- This project uses **ZenStack v3** (`@zenstackhq/orm`) with **Kysely**.
- **Supported Databases ONLY**: PostgreSQL (`pg`), MySQL (`mysql2`), and SQLite (`better-sqlite3`).
- **STRICTLY PROHIBITED**: Do NOT add support for MSSQL / SQL Server. Never install `tedious`, `tarn`, `mssql`, or configure `MssqlDialect`.
- Keep `schema.zmodel` database-agnostic by avoiding dialect-specific attributes (e.g., `@db.VarChar`, `@db.JsonB`) and scalar arrays.
