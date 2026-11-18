---
name: deployment
description: "LOC Cloudflare Pages／GitHub Workflow／IPA 部署與按需接收 LAS 通知，不部署 LAS Auth/MCP Worker 或 LRS。"
---

# LOC Deployment／Operations

LOC 只發布 **LOC Cloudflare Pages `loc`**、自身業務 API 與 **LOC 自己的 App／IPA**。LRS 自己負責 LRS Web 與 LRS App／IPA，LAS 自己部署 Auth／MCP／Plugins；三者不互相觸發例行建置。正式網域 `loc.lo3rwang.cc`；LAS 的 `auth.lo3rwang.cc` 與 `mcp.lo3rwang.cc` 都指向既有 `lunarcus` Worker，**不是 LOC Pages Gateway**。不要從 LOC 部署、打包或恢復 LAS MCP／Auth Server，也不發布 LRS。

LOC 的網站與 Scope 路由表只由 LOC 維護；LRS 另有自己的 Web 路由表，LAS 的 Auth／MCP 主機與協定路由由 LAS 管理。跨 Repo 只使用既有連結或驗證過的 API 契約，不以共用 Routing Table 或聯動部署整合。

## 獨立部署

LOC 的 Cloudflare Pages 只由 LOC Repo 自行觸發建置與預覽。GitHub Actions 只保留 LOC 的手動基本部署與手動 IPA 部署；不得接收或發出 LAS／LRS 的 Build、Preview、Deploy 觸發。跨系統引用以既有連結、資產副本與明確 API 契約為限，未來需要整合打包時另依當次需求實作，不重新綁定平常部署。

## 驗證與外部變更

先核對真正生效的 main SHA、Cloudflare Pages watch paths、單一正式部署、GitHub Workflow、已發行 LAS Worker 版本。LOC 平常只執行語法檢查及本機大量刪改檔案數量檢查；Build、Preview 與實際功能狀態依各自結果分開回報。

不因 Pure docs、Skill、註解或 LAS Plugins 更新而反覆編譯或發布 LOC。對外設定（DNS、Secret、Binding、Access、Worker、路由、Build 規則）須先列出準確差異、影響與復原方式，取得當次明確授權後才操作。已退役的 ISR 不得當作 LOC 部署的前置條件或重建入口。
