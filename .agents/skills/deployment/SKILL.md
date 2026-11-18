---
name: deployment
description: "LOC Cloudflare Pages／GitHub Workflow／IPA 部署與按需接收 LAS 通知，不部署 LAS Auth/MCP Worker 或 LRS。"
---

# LOC Deployment／Operations

LOC 只發布 **LOC Cloudflare Pages `loc`**、自身業務 API 與 **LOC 自己的 App／IPA**。LRS 自己負責 LRS Web 與 LRS App／IPA，LAS 自己部署 Auth／MCP／Plugins；三者不互相觸發例行建置。正式網域 `loc.lo3rwang.cc`；LAS 的 `auth.lo3rwang.cc` 與 `mcp.lo3rwang.cc` 都指向既有 `lunarcus` Worker，**不是 LOC Pages Gateway**。不要從 LOC 部署、打包或恢復 LAS MCP／Auth Server，也不發布 LRS。

## 跨 Repo 更新的正確順序

LAS 先獨立成功部署，然後自行判斷是否需要通知 LOC。Plugins、CMS Mapping、LAS Auth/MCP 內部改動通常是 `skip`，不通知 LOC、不建置 LOC。只有已發布且確實改變 LOC 依賴契約的版本，在驗證後才以 **Cloudflare LAS → LOC GitHub Workflow** 通知一次；LOC 自己驗證版本、有效授權、去重和部署條件後執行。不能把每次 LAS 更新直接 POST LOC Pages Deploy Hook，也不能把 LRS 的緊急 Workflow 當一般發布管線。未完成驗收的通知機制必須標明未完成，不自行宣稱已接通。

## 驗證與外部變更

先核對真正生效的 main SHA、Cloudflare Pages watch paths、單一正式部署、GitHub Workflow、已發行 LAS Worker 版本。必要的 Preview、Build、實際 API 測試分開紀錄，不能以 CI 綠燈代替授權及 SSO 驗收。

不因 Pure docs、Skill、註解或 LAS Plugins 更新而反覆編譯或發布 LOC。對外設定（DNS、Secret、Binding、Access、Worker、路由、Build 規則）須先列出準確差異、影響與復原方式，取得當次明確授權後才操作。ISR 目前仍由既有 `loc-isr` 保留且預設關閉，往後交 LAS 必須獨立安全驗收。
