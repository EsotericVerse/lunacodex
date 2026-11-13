---
name: sql
description: "處理 SQL、資料庫、查詢、JOIN、schema、效能與 SQL 相關程式整合；不按 Kysely、ZenStack、Zod、Neon 逐一載入。"
---

# SQL / Database — 資料工作入口

先看實際 SQL、schema、資料型別、連線與程式碼，再判斷要做查詢、寫入、JOIN、效能分析或欄位調整。**SQL 是工作類型，ORM／query builder／validation 是實作細節**，不得因程式引用 Kysely、ZenStack、Zod、Neon 就各載一份 Skill。

需要 ZenStack V3 查詢／關聯／交易與 Kysely `$qb` 時，一份 ZenStack 查詢文件就足夠；不要再連動讀取 Kysely。獨立 Kysely SQL builder、ZModel 結構、Zod 型別、Neon 專用特性，只有實際碰到該問題時才開對應資料。

不預設 migration、資料庫管理權或新增抽象層。依 LOC 已有模型與使用者指示執行。必要的舊專題指引見 `.agents/SKILL-LINKS.md`（按需選一份，不批次讀）。
