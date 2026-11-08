# LOC 委託式來源映射與 Pattern Anchor（資料表階段，2026-11-09）

LOC（LunaCodex）是**語言委託框架**，目的是 Codex **綜合目錄導覽**。
委託人提供 Mapping 及 Auth Reference；外部資料保持原地、原 Schema，
LOC 依設定讀取與解析，而非替他建立另一份文章庫。

## 第一部分：LOC 映射中樞

`silver.loc_anchor` 新增，沿用 Anchor 物理欄位
`uid / type / title / description / invisible / attr / createtime`，
另有 `num bigint NOT NULL DEFAULT 0`。

- `type=database`：資料庫／資料來源身分，`uid` 是穩定的八碼 Base62 識別。
  `attr.uid` 可連結該資料來源旗下的 Table 映射 UID。
- `type=table`：映射到委託人現有資料表；`attr.database_uid` 指向 Database Anchor，
  `attr.mapping` 預留給**委託人提供**的欄位對應（不限於 LOC 現有 Galaxy Schema）。
- `attr` 只能存委託設定所需的中繼資料與不透明 Auth Reference，
  **不可儲存委託人帳密、Access Token、文章內文，也不要求改寫外部表**。
- 管理映射只准受 LOC Auth 許可的受信任伺服端讀寫。
  本次沒有賦予瀏覽器匿名或一般登入帳號直接 SELECT 權限。

目前沒有使用者提供的 Mapping，`loc_anchor` **刻意不種入虛構紀錄**。

## 第二部分：Scope 擁有 Pattern

每個 Scope 的 `silver.<scopeid>_anchor` 現在容許 `type=pattern`，
並新增獨立實體 `num bigint NOT NULL DEFAULT 0 CHECK (num >= 0)`。
仍由 Scope 自己保管詞級索引，LOC 不集中存另一份文章索引。

- `Category → Class → Group → Item → Pattern`：新 Item 的 `attr.uid` 連到多個
  Pattern Anchor UID。既存 Item 的 `attr.keyword` 暫保留相容，
  本次**不破壞、不批次轉寫原本 Item**。
- Pattern 的 `title` 是詞彙，`attr` 是以資料來源 UID 為 key 的 JSON 物件：

```json
{
  "uid": "PAT00001",
  "type": "pattern",
  "title": "示例詞彙",
  "num": 2,
  "attr": {
    "DB000001": ["ART00001", "ART00002"]
  }
}
```

其中 `DB000001` 是委託來源的穩定 UID，所對應的文章 UID 留在原資料庫。
同一文章 UID 在不同資料庫可以重複；跨庫去重必須同時考慮資料來源 UID。
一個來源時就只有一個 JSON array，將來增加來源不需修改 Anchor Schema。

`num` 是解析完成後該 Pattern 的**不同文章命中數**，不是 Pattern
子節點數，也不是自由文字出現次數。現有錨點預設 `num=0`，屬於
**尚未重建統計**，不可當作已計算的真實零命中。
具體文章 UID list 的維護、刪除同步與跨庫合併，交由下一階段索引程式處理。

## 第三部分：舊索引與切換

`silver.loc_search_pattern` 在 Migration 前實際為 **0 筆**。
目前部分搜尋、關鍵詞統計與分析程序仍呼叫這張表，所以
**本次不刪除也不改寫它**。日後需將讀取、增量解析、統計、
自動完成改為 Scope Pattern Anchor，實際驗證後再刪舊表；
不能把只完成資料表認作已完成索引演算法切換。

此次 SQL 只新增 `loc_anchor`、為已註冊有效 Scope Anchor
加 `num`，並擴展 CHECK 讓 `pattern` 和新式 Item.uid 進入；
舊式 Item、Rune 特例與其他 Anchor 類型原規則全部保留。
無新 RPC、Trigger、全文搜尋模組、外部資料複製或自動部署。

Migration：`supabase/migrations/20261109013000_loc_anchor_scope_pattern_num.sql`
