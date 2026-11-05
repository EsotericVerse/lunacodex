# LOC：從真實資料庫核對 Schema Baseline（2026-11-06）

## 範圍與目的

這是 PR #1069 清理後的**下一階段驗證文件**，不是宣告 Baseline 已完成。PR #1069 在 2026-11-06 03:28（Asia/Taipei）合併，從當時的 136 份 Migration 刪除 89 份。主分支此後另加入兩份 SQL，因此本次檢視主分支有 **49 份** Migration（不是原本快照的 47 份）。

禁止把已刪 Migration 當作全新資料庫可直接 replay 的保證。**這 49 份仍是零散歷史補丁，不是完整初始 Schema。**

## 來源

- GitHub: `EsotericVerse/moon-runes-pwa`，`main`，2026-11-06 查詢。
- 已獲授權的 Supabase 專案 `qlouywsdiiyiyzpoxyqy`：唯讀查詢 `information_schema.tables`、`pg_proc`、`pg_policies`。
- 可重跑檢查：`scripts/sql/loc-schema-baseline-audit.sql`（全為 SELECT）。

## 實際存在的業務 Table

`api`：`loc_user`、`manage`、`user_records`、`user_settings`。

`silver`：`VisualNovel`、`game`、`lo3rwang`、`lo3rwang_anchor`、`lo3rwang_blocks`、`lo3rwang_galaxy`、`loc`、`loc_blocks`、`lrunes`、`lrunes_anchor`、`lrunes_blocks`、`lrunes_daily`、`lrunes_galaxy`、`manage`、`runes`、`runes_etc`、`runes_group`。

不能因為 `VisualNovel`、`game` 或 rune 系列表不在 Anchor 主要四表規劃中就推定可以刪除。

## 已確認的實際殘留

正式資料庫 `api.provision_scope(...)` 的定義仍拼出 `_galaxy_media`、`_time`、`_keywords` 等歷史表名，並保留依舊 Schema 建立新 Scope 的邏輯。

`api.delete_scope(text)` 仍依序檢查、刪除 `_galaxy_media`、`_trace`、`_time`、`_keywords`、`_place` 等舊表名。這是**執行期 SQL 函式殘留**，刪除 Migration 檔案並不會使它消失。

這兩個函式是否仍有現役使用者、API、Policy、Trigger 相依關係，尚未核實。**不得直接 CASCADE DROP 或把其失效視為驗證通過。**下一步是逐一確認 Kysely 新 Scope 建立／刪除路徑與授權功能，再安全退役舊函式。

## 同時進行的改動

主分支近期新增：

- `20261106020000_retire_legacy_block_move_rpcs.sql`：退役舊 `move_scope_block` SQL；保留現行 Kysely managed action。不可恢復已退役 SQL。
- `20261106035500_private_mcp_pr_galaxy_visibility.sql`：限制 `site=mcp` 與 GitHub PR 來源的公開能見度。清理 Baseline 時須保留其存取語意、八個獨立 Boolean 權限及 Scope 管理者權限。

**MCP 僅透過 `galaxy_link` 的授權／QoS 限定搜尋，不應變成公開的全庫查詢端點。** 非 PR 的 GitHub 作品、小說與合法資料不能被當成垃圾刪除。

## 真正的完成門檻

1. 針對實際保留的 Table、generated date、索引、八個 Galaxy Boolean 欄位、Policy／Trigger／Function 產出單一可驗證的 Baseline；不倒回舊四表結構。
2. 完整核對 `api.provision_scope`、`api.delete_scope` 的呼叫點及 Postgres 依賴，再移除舊 SQL 路徑；以現行 Kysely 和 Clerk／LOC Authority 為準。
3. 在**全新、隔離的 PostgreSQL** 上測試 Baseline，驗證 Anchor／Galaxy／Blocks、Scopes、登入授權、搜尋、MCP；不可在正式業務資料庫測試 `DROP`。
4. 核對是否還有直接執行舊 RPC、`ORDER BY uid` 的應用與 migration SQL；以 `date`／`createtime` 排序。
5. 不改動其他 Agent 正在處理的文化、首頁、`move_scope_block` 程式。必要修改需協調後分立 PR。
6. 只有 Baseline 建立、隔離初始化測試和端到端驗證**實際成功**，才可以宣告 Migration 清理完成。

## 目前狀態

**已完成：** 對照正式資料表、確認兩個具體歷史 SQL 函式殘留、建立可重跑的唯讀核查程序。

**未完成：** 新 Baseline、舊函式的安全退役、空白資料庫初始化、Kysely／MCP 端到端驗證。本文件不得替代測試結果。
