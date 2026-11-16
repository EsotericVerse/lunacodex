---
name: sql
description: "LOC SQL Portable、Z-Model／Kysely 方言、Schema、資料存取、效能與 Scope 授權；不替 LAS 或 LRS 維護資料庫。"
---

# LOC SQL Portable — 資料工作入口

**LOC 是 SQL Portable 的整合主體，不綁單一 MySQL／PostgreSQL／MSSQL。** 實作以現行 `modules/loc/dialect`、ZenStack／Z-Model、Kysely、資料模型與真正的多方言測試為準；不同引擎的可攜程度須以證據證明，不能只憑編譯結果宣稱一致。

先看具體查詢、型別、Schema、JOIN、索引、資料庫方言與可信任授權，再決定修哪一層。Kysely／ZenStack／Zod 是工具而不是另一套 SQL Gateway；勿為了讀取不同引擎而複製資料操作或重建任意 SQL API。

**LAS Auth 固定使用其本身 PostgreSQL**；不將 LAS 的 `las_*` 身份表搬進 LOC。LRS 的資料庫與 Rune 也各自負責。LOC 透過固定、已驗證的 API 接收 LAS 提供的身份，不接受 LAS 提供任意 SQL，Scope／`api.manage` 權限仍由 LOC 做最終判斷。

請保留現有 LOC 業務層 `/api/las-native`、`/api/loc-native`、`native-operations.mjs`；這不是已退休的 MCP Gateway。必要時從 `.agents/SKILL-LINKS.md` 選一份與問題相關的 SQL／Dialect 文檔，不預讀全部。
