---
name: mcp-builder
description: "LOC 的 MCP 相鄰業務介面及可攜式資料服務；只檢查契約，不在 LOC 實作或部署 MCP Gateway。"
---
# MCP 在 LOC：業務契約，不是 Gateway

**MCP Server 的單一原始碼與實際執行入口位於 LAS（`EsotericVerse/lunarcus`）。** 其既有 `lunarcus` Worker 同時服務 `auth.lo3rwang.cc`、`mcp.lo3rwang.cc`。MCP JSON-RPC、工具 schema、OAuth Protected Resource、SSE／Streamable HTTP、Provider OAuth／Policy／Vault／Tools、Plugins 相關通訊都在 LAS 維護，不能重新複製回 LOC。

LOC 此 Skill 的用途只限 **LAS 使用 LOC 資料服務的業務契約**：
- `functions/api/las-native.js`：LAS 專用的固定業務 API，不接受任意 SQL、DB URL、任意代理目的地或隱性權限授予。
- `functions/api/loc-native.js`、`app/loc/mcp/native-operations.mjs`：LOC Scope／`api.manage`／Galaxy／Anchor、匯入、查詢及 SQL Portable 的實際業務授權與資料操作。沿用仍存在的歷史目錄，不依名稱判定責任。
- `app/loc/mcp/native-kysely.mjs` 與 LOC dialect／Z-Model：屬 LOC 資料來源；LAS 不接管 DB，也不複製一份。

工作方式：先驗證 LAS 對 LOC 的固定 operation、OAuth issuer／audience、UserInfo 身份綁定、Scope 權限、出入參數、錯誤／回執及 SQL 方言；遇到真正的 MCP 傳輸、tools/list、Provider 或 Extension 變更，移至 LAS Repo 與其 `mcp-builder`／`mcp-gateway` Skill 處理。LOC 不重建 `functions/mcp.js`、`functions/index.js` 或 `/.well-known/oauth-protected-resource*`，不再開平行的 Worker。

LOC 不再保留專用 `test-*` 腳本；以 LOC 語法檢查、獨立 Build／Preview 和必要的實際業務回應判斷 LOC 部分的狀態。LAS MCP 協定不由 LOC 測試或部署。

更詳細的外部 MCP SDK 參考見 `.agents/SKILL-LINKS.md`；僅當 LOC 的實際介面契約需要時按需查閱，不批次載入。
