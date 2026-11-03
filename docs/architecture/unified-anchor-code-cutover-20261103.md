# LOC 四表合一：Code 實際切換與驗收（2026-11-03）

本文件記錄 PR #971 的 Code 層修正；`silver.lo3rwang_anchor`、`silver.lrunes_anchor` 均已是六欄（`uid/type/title/description/invisible/attr`）。本 PR **不修改 RPC、DDL、資料或 Neon**。

## 資料存取契約

- 原生 Anchor 實體表：`silver.<scope>_anchor`。八碼、大小寫敏感 Base62 UID；`type` 區分日期、空間、關鍵詞和媒體。
- 時間：`scope.time` 對應 **虛擬** `silver.<scope>_time`，由 `unified-anchor-compat.mjs` 轉為原生 `type=date/period/era` 和 `attr.date/uid/period`；UI／邏輯模型中的 `address/anchor_ids` 為有意保留的映射，不是 Anchor 實體欄位。
- 空間：原生 `point/path/trace`；文章 `place_id` 必須為八碼 Base62，不能強制大寫；舊 `trace_type/route_list/anchor_list` 只在相容 UI 模型使用。
- 關鍵詞：`_keywords` 是相容介面；`lists` 映射到 `attr.uid` 或 `attr.keyword`。**`attr.total` 無法重建逐篇 `uid_lists`**，詳細命中／交集依賴現有資料庫端查詢，不能擅自捏造文章 UID。
- 媒體：`_galaxy_media` 是相容介面；`url` → `attr.url`、`meta_tags` → `description`、`date` → `attr.date`。來源未提供日期的媒體維持無日期（不推算 `createtime`）。
- 獨立 `local` SQLite 不走雲端 Anchor 轉換，`loc` Group 也不視為一般 Scope。

## 修改範圍

1. `scope-data.js`：統一 `scope.time` 的虛擬讀寫契約，保留 `scope.anchor` 原生入口。
2. `galaxy-query.js`：文化時間上下文共用時間區間解析，空間 UID 八碼驗證，多媒體搜尋／統計的 `date` 來源與過濾。
3. `time-anchor-ranges.mjs`、`CultureTimelineEditor.jsx`：新時間定錨 UID 使用共用八碼 Base62 allocator；區間 UID 大小寫原樣保留，歷史四碼字串仍可讀取。
4. `Search.jsx`、`search-edit-draft.js`：文章 `place_id` 八碼驗證；媒體編輯不再寫 `location/createtime`，改為明確 `date`。
5. `unified-anchor-compat.mjs`：時間／媒體日期由 SQL JSON 路徑查詢與排序、媒體 URL SQL 查詢；清除媒體日期時僅移除 `attr.date`。
6. `providers/kysely-runtime.mjs`：僅在 `silver.*_anchor` 上允許 `attr->>date` 與 `attr->>url` 欄位過濾、OR 和排序；其他 JSON 欄位照舊拒絕。**不改 RPC 清單及 RPC 定義**。
7. Regression tests：`test-unified-anchor-cutover.mjs`、`test-time-anchor-ranges.mjs`、`test-time-schema-migration.mjs`、`test-culture-time-anchor-autocomplete.mjs`。

## 驗收與合併門檻

- 已完成：GitHub `main` 呼叫路徑核對、Supabase 唯讀 Schema／日期欄查核；Node 相容程式的 V8 語法解析、Kysely Gateway 模擬查詢與惡意 JSON 路徑拒絕檢查、八碼時間 UID／媒體更新模擬。
- **仍需執行**：在完整 repository checkout 執行 `npm run check:syntax`（合併必備），以及 `node --test scripts/test-unified-anchor-cutover.mjs scripts/test-time-anchor-ranges.mjs scripts/test-time-schema-migration.mjs scripts/test-culture-time-anchor-autocomplete.mjs scripts/test-article-inline-time-anchor.mjs`。不能把局部 V8 語法檢查冒稱完整 syntax gate。
- 回歸測試通過後才合併至 `main`；Cloudflare 正式部署及實際文化／搜尋／痕跡操作須另驗收。
- RPC 與 Neon Schema 由其他作業處理；本 PR 不加入新表、新索引、新欄位，不搬移既有使用者資料。

## 仍需跨組追蹤

- 關鍵詞 `attr.total` 是否足以支援各 Class 的詳細分析；無逐篇 UID 時不得由總數推測交集。
- 備援資料庫若尚未配置完整可讀取路徑，不可宣稱已完成切換與容錯。
- 公開／隱藏文章權限以現行 `Galaxy.able` 和 RLS 為準，不可因相容層修改而擴大讀取。
