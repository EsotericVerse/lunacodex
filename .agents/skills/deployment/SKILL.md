---
name: deployment
description: "GitHub、CI/CD、Vercel、Cloudflare 部署、效能、成本與工程維運入口；不預讀全部部署插件技能。"
---

# Deployment / Operations — 部署維運入口

先檢查 LOC 已有 CI/CD、Vercel、Cloudflare 的設定與現行工作流程；依實際錯誤、成本、部署或權限問題處理，不自行擴大部署權限、次數或環境。

Vercel CLI、部署、成本最佳化等專用技能，只有已確認對當前問題有必要時，才由 `.agents/SKILL-LINKS.md` 開啟相應連結；不因列出多個平台而批次讀取。

## 部署驗證與外部變更界線

Preview Deployment 可用於實際驗證，但「建置／部署成功」不等於 Bug 已修好。Agent 必須區分 Preview 與 main 的 commit SHA、環境與功能結果，完成合併後再確認 main 對應版本；不能讓使用者反覆代測、也不能以部署成功交差。保留目前已有的 Preview 和觸發機制，不為排錯任意改動。

先以目前 repo、GitHub 記錄與合法可用的只讀資料查明原因；**不因 Agent 想加快偵錯，就要求全面開放 Cloudflare MCP**。涉及外部平台的變數、Secret、Binding、Access、Worker、路由、資源或權限的任何寫入、刪除、建立，先列對象、差異、影響、復原方式，取得使用者明確同意後才操作；通過口頭預告不算授權。不得廣泛清理資源或在未知根因時批量修改配置。
