# LOC 四表合一殘留 Regex 盤點（2026-11-06）

## 規則與範圍

- 查 GitHub `main`：`_time`、`_keyword`、`_trace`、`_media` 四組字串，再逐一分辨是否為**實體舊資料表**。初步 GitHub 搜尋 `_time` 至少 100 個檔案（搜尋上限）；`_keyword` 71、`_trace` 52、`_media` 56 個命中檔案。這是廣義文字命中，非待刪檔案總數。
- 查正式 Supabase `pg_proc.prosrc ~* '(_time|_keyword|_trace|_media)'` 與 `pg_class.relname`，同時比對正在使用的前端、Kysely providers。`media_link` 是正式 Galaxy 關聯欄位，必須保留；`_media` 也可能是 CSS 類別或正常函式名稱。
- 舊 Migration 保留為歷史紀錄；不能單憑舊 Migration 文字就認定目前正式資料庫仍有相同物件。

## 正式資料庫核對

| 類型 | 正式結果 | 處置 |
|---|---|---|
| 舊 `_time`、`_keywords`、`_trace`、`_media` Scope 表 | 在 `api/silver/public` 實體 relation 清單沒有找到這些舊資料表 | 不需對不存在的表 DROP；清理執行期存取 |
| `api.lo3rwang_keywords_manage` | 尚存在 View | 查使用者／依賴後決定移除或轉 Anchor |
| `silver.{lo3rwang,loc,lrunes}_trace_short_seq` | 三個 Sequence 仍存在；資料庫 dependency 查詢顯示 0 個 dependent objects | 檢查動態 `nextval` 引用，再獨立移除 |
| `api.provision_scope()`／`api.delete_scope()` | 本次正式 `pg_proc` 查無兩個同名函式 | 舊 baseline 文件所述已過時；不用再直接刪除 |
| `silver.record_permission_check(text)` | 仍在，定義引用已刪除的 `silver.lo3rwang.count` | 先確認有無呼叫，再 retire；不要重新加 count |
| `silver.read_scope_linked_media_count()` | 已刪除，且 `read_scope_overview` 不再回傳 `media_count` | `galaxy.media_link` 保留供正常附件連結 |

## 現役前端／Provider 必須優先修復

| 檔案 | 現有殘留 | 原則 |
|---|---|---|
| `app/loc/place-summary-client.js` | `selectRows('silver.'+scopeId+'_trace')` | 改查 Anchor `type='point'` 或沿用統一 Adapter，避免舊表讀取 |
| `app/modular/features/trace/trace-spatial-reference-data.js` | 兩條 `dbPublicClient.from(scope+'_trace')` | 改為查 Anchor `point` 名稱；尤其不要在痕跡頁無限補載 |
| `app/loc/galaxy-query.js` | LRUNES 等非已轉換 Scope 仍有 `'_trace'` 讀取後備 | 核對所有 Scope `_anchor` 切換與深連結；已四表合一的 Scope 不可走舊表 |
| `app/loc/db-contract.mjs` | 關鍵詞 reset/read/shared/write/copy 多處 `silver.<scope>_keywords` | 優先查明是否還走現役呼叫，改用 Anchor 的 Class／Group／Item；不能只替換表名（欄位不同） |
| `app/loc/scope-data.js` | `keywords: silver.<scope>_keywords`，`galaxyMedia: galaxy+'_media'` 相容 alias | 檢查 adapter 是否確實轉至 Anchor；勿把有意義的 `media_link`／Schema 名稱一併刪除 |
| `app/loc/providers/kysely-scope-admin.mjs` | 新 Scope 建立、刪除與名稱衝突檢查仍列 `_time/_keywords/_trace/_galaxy_media` | 刪表作業先驗證新 Scope 路徑；歷史舊名可在保護性防碰撞清單保留，不建立舊表 |

## 正式 RPC 中的廣義 Regex 命中（不是全部可刪）

- `api.management_write`：`_media` 命中屬舊表權限判斷；此 RPC 目前也處理正常文章媒體寫入，不可直接 DROP。
- `silver.import_shared_keyword_class`、`read_keyword_tree_summary`、`read_shared_keyword_classes`、`read_trace_keyword_group_totals`、`scope_keyword_catalog`：存在 `_keywords` 舊表／變數／相容路徑。需逐一檢查 `Anchor` 分支有效性、`pg_depend`、Kysely 呼叫，再移除舊後備。
- `silver.read_scope_analytics`：`_keyword/_trace/_media` 的命中有 RPC **名稱**，不等於讀舊表。依實際 SQL 解析分類。
- `silver.refresh_scope_search_summary`：`_time` 可來自 `timestamp`、其他時間欄位字串；需用完整符號邊界核對，不能因 `_time` 部分字串就刪函式。
- `silver.record_permission_check`：與四表無關，卻依賴已刪 `count`，另列為確定的殘留。

## 安全處理順序

1. 先修前端實際查不存在的 `_trace`／`_keywords`，不變更已正常運作的地圖與使用者資料。
2. 檢查活躍 RPC 呼叫圖與函式簽章，將仍使用的查詢轉向 Anchor；對確定無依賴的舊 RPC 逐筆 `DROP FUNCTION`（不使用 CASCADE）。
3. Sequence／View 另檢查動態 SQL 及外部相容，再退役。
4. 最後執行文化、統計、搜尋、痕跡／關鍵詞跨 Scope 的回歸驗收與 Portable 驗收。

**本文件是盤點記錄，不代表全部命中都該刪，也不宣稱已掃過 GitHub 搜尋上限之外的所有檔案。**

## 2026-11-06｜第二輪：實作完成／新增舊欄位 Regex

- `app/loc/place-summary-client.js`：改為直接 `selectRows(scope.anchor)`，僅篩選 `type=point`、投影 UID/title，不再走 `_trace` 虛擬表名。
- `app/modular/features/trace/trace-spatial-reference-data.js`：兩個讀取入口直接查 `scope+'_anchor'` 的 `type=point`，使用 `attr.longitude/latitude`；保留原本名稱搜尋、跨 Scope 篩選、候選數上限，無路線與地圖資料變更。
- 已透過 `20261106235000_retire_legacy_trace_sequences_and_permission_counter.sql` 清理：`silver.record_permission_check(text)`、三個 `silver.{lo3rwang,loc,lrunes}_trace_short_seq`。正式資料庫驗證四項全部不存在且 Anchor 的 `attr` 欄位保留；事前 `pg_depend` 查詢各為零，且搜尋不到直接呼叫。沒有 `CASCADE`。
- 請留意：資料庫 SDK 的 `unifiedAnchorRelation` 曾把 `_trace`/`_keywords` 的虛擬表名導到 `_anchor`，因此舊字串不必然等同實際 SQL 查詢舊實體表。本次直接改實體 `_anchor`，是減少隱性依賴並使 SQL 層清晰。
- 新增 Regex：`search_able` (11 個命中檔案)、`statics_able` (0)、`space_trace` (3)、`time_trace` (2)、`source_place` (1)、`event`/`road`（正常事件與路線詞過多，依 SQL 識別字細分）。
- 正式 `information_schema.columns` 查詢未見 `search_able`/`statics_able`/`space_trace`/`time_trace`/`source_place` 或欄位 `event`/`road`。`silver.game.event_*` 六項屬遊戲正常資料。
- `search_able` 現用於前端 Scope feature 設定相容映射與本機 SQLite，不可直接刪鍵；`SPACE_TRACE` 是有效的空間 Trace 類別常數，不是已退役欄位；`road` 常為地圖道路圖層，不可整批取代。
- 待下一次有依賴驗證的程式清理：`db-contract.mjs` 的關鍵詞虛擬欄位投影和 `scope-data.js` 相容別名；正式 `silver` 關鍵詞 RPC 的舊 `_keywords` 後備查詢；`api.lo3rwang_keywords_manage` View。勿直接字串替換不同 `attr` 格式。
