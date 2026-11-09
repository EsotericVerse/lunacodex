# Scope Pattern 索引（現行）

目前使用單一資料庫。詞級索引位於各 Scope 自己的 Anchor `type=pattern`，其 `attr` 保留現有 UID 索引格式；`num` 記錄命中篇數。既有資料與 UID 關聯不更動。

LOC 不建立獨立的 Database／Table Mapping Registry，也不查詢資料庫身分 UID。
