# LOC 詞級索引與增量解析 — 2026-11-08

> **現行實作：** 各 Scope 自己的 `type=pattern` 儲存詞級索引；無獨立的 LOC Mapping Registry。以下保留舊索引設計說明。

## 唯一詞級資料來源

`silver.loc_search_pattern` 只有五個欄位：

| 欄位 | 定義 |
| --- | --- |
| `scopeid` | Scope 索引識別 |
| `pattern` | Item 名稱或 Item 內的獨立字面關鍵詞，NFKC 正規化 |
| `count` | 命中此詞的**不同文章 UID 篇數** |
| `uid_list` | 此詞的去重 Galaxy UID 清單 |
| `update_time` | 詞的 UID 集合**實際變動**時間；未變就保留 |

ZModel / Anchor 只管理 Category → Class → Group → Item → 字面關鍵詞的階層及詞庫內容。**Anchor 不再存 Group / Item 數量及文章 UID 統計。** 也不把 Class/Group 的名稱當作詞寫入 pattern；同字詞若是 Item 名稱或 Item 內文字則正常收錄。

## 第一次與增量解析

- 第一次未有 `pattern`，對選定 Class 的所有詞做全文命中解析，寫入每詞的 `uid_list/count`。
- 文章原始匯入／更新時間使用 **Galaxy.`UpdateTime`**。各個詞最後成功掃描時間保存於現有 Scope `keyword_meta.pattern_scans[normalizedWord]` JSON；不是增加第六個 pattern 欄位。
- 後續解析先只讀 Galaxy `uid/date/createtime/UpdateTime/keyword`，不預先下載所有內文。
- 對每個詞：文章的 `UpdateTime` 早於該詞最後成功掃描時間，直接沿用原來的 UID 是否命中；**不再檢索該文章內文**。新增詞須遍歷過去文章，但不會迫使舊詞重算；新增或更新的文章只針對必要的詞讀內文。
- 文章被刪除、或 `keyword` 已不為 true，清除其舊 UID 命中。更新後不再包含某詞，也必須從該詞 UID 集合移除。
- 詞級寫入與 Scope 完成標記在同一資料庫交易內進行；沒有全部成功不推進詞的掃描時間。只有 UID 集合變化才更新該詞的 `update_time`。
- 不增加詞級時間欄位、不跨 Class 重跑另一組詞、不設額外的詞／Class 對照表、不復活 RPC、FlexSearch、RAG 或通用 SQL Gateway。

## Index → Group/Item/單詞統計

每個 Item 包含自身名稱及其內每個詞。透過 ZModel 取這些詞後，直接讀同一 Scope 的詞級紀錄組合：

- **Item 命中數** = 各不同詞的 `count` 加總；同一 Item 重複列出的詞先去重。
- **Item 涉及篇數** = 各詞 `uid_list` 取聯集後的不同 UID 數。
- **Group/整個 Class** = 下層 Item 組合；篇數仍按 UID 去重，不能把相同文章重複當不同篇。
- **單詞比率** = 此詞 `count` / 所屬 Item 命中總數；Item/Group 比率的分母是該 Class 的所有 Item 命中總數。若分母 0，顯示 0。
- 例如新 Item「水火」內含「水」「火」，可直接沿用既有兩詞 UID；「水火」作為 Item 名稱又是獨立字面詞，若尚未解析會標示待建立，而不虛構它的 UID。
- 依年月日與來源分段時，僅透過既有 UID 讀 Galaxy 日期/來源中繼資料；不掃全文，不從 Anchor 取數量。

## 網站入口與權限

靜態 Pages 前端以固定的同源 `POST /api/keywords` 呼叫，操作限定 `analyze/classes/catalog/summary/stats/suggest`。同一 Cloudflare Pages 應用中的伺服器端 Kysely 實作：瀏覽器不傳連線字串、SQL 種類或任意 SQL。

使用現有 LOC Auth 的 RS256/JWKS 委託驗證、Scope 寫入權限及 Class 發布政策。私人 Class 不能透過搜尋補字或統計被匿名讀取；搜尋自動完成只回傳 `pattern/count`，不回傳文章 UID 或內文。一般文章全文搜尋仍走原有搜尋流程。

索引資料保存在 `loc_search_pattern`，**Scope DB 斷線時繼續顯示已存數據**的離線容錯另行處理，此批不包含。

## 核驗

- `node --test scripts/test-keyword-incremental.mjs scripts/test-loc-search-pattern.mjs scripts/test-keyword-reanalysis.mjs`
- 已用原始程式碼函式執行資料測試：首次掃兩篇內文、重跑相同時間掃零篇、修改一篇只查該篇；詞加總 4 筆、UID 去重 3 篇。
- 部署後還需在具有真實 LOC Auth 委託與設定好伺服端資料庫連線的 Pages 上驗證 API，且先進行首次正式解析才有詞級數據。
