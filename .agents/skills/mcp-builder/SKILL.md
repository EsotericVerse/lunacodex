---
name: mcp-builder
description: "Build or review MCP servers, tools, resource APIs and integrations only when the task calls for an MCP implementation."
---
# MCP — 工作入口

MCP Gateway、Auth、Plugins 與公開 OAuth Resource Server 已歸 `EsotericVerse/lunarcus` 的既有 `lunarcus` Worker。LOC 只維護自身 `/api/las-native`、資料查詢及獨立權限；不要在 LOC 重建 `/mcp` 或 `/.well-known/oauth-protected-resource`。舊的 Provider Manager 仍是 LOC 受權的網站控制 API，必須等憑證／使用者流程另行驗收後才能安全移轉。遵守既有權限與工具授權邊界。MCP 交互不等於一併載入 Auth、SQL、Extension 技能。需要具體 MCP SDK、驗證、評測程式碼時，**才開單一 HTTP 連結**。

- [完整 MCP Skill](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/mcp-builder/SKILL.md)
- [Node/TypeScript 服務端參考](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/mcp-builder/reference/node_mcp_server.md)
- [MCP 實務](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/mcp-builder/reference/mcp_best_practices.md)
- 其他專題與腳本：`.agents/SKILL-LINKS.md`。

參考文件及腳本不在本機 Skill 目錄；需要執行腳本時，另行取得並核對版本與依賴，禁止開工時批次下載。
