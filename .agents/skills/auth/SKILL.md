---
name: auth
description: "身份、SSO、OAuth、OIDC、Session、驗證及授權邊界；保留 LOC 現有 Cloudflare SSO 與 Better Auth，不自動變更提供者。"
---

# Auth / Identity — 身分與授權入口

處理登入、SSO、OAuth2/OIDC、Session、授權與 API 存取時，先看目前 LOC Auth、Cloudflare SSO 與現行程式碼。不可因資料庫或 MCP 同時出現便強制載入所有資料庫 Skill。

Better Auth 是模組，不是「每個 Better Auth Plugin 就需要一份 Skill」。除非正在實作其特定功能，否則不要連動載入密碼、組織、雙因素或 Neon Auth 的專用指引。已完成的身分提供者和權限策略不得自行替換。

需要特定 API 版本或疑難排解時，從 `.agents/SKILL-LINKS.md` 選一份最貼近問題的固定版本資料，必要時確認官方最新文件。

## SSO 故障：先確定第一個失敗邊界

依真實請求追蹤登入入口 → Cloudflare Access／SSO → OIDC callback → LOC Auth → LOC Web session／redirect 的**第一個異常環節**；先比對 main 版本、現有設定鍵名（不讀取或外洩 Secret 值）、安全日誌、回應狀態與 callback 路由，不因「登入失敗」就直接斷言是哪個平台或變數有問題。相同錯誤反覆出現，不能再用未驗證的變數替換與多次登入測試當作進度。

只有使用者的私人登入狀態能辨別問題時，提出一次具判別力的觀察並說明結果的分支與下一步。不要要求使用者提供登入憑證、Secret 或開放 Cloudflare 管理 MCP。**Cloudflare 變數、Binding、Access 與資源的寫入、刪除或建立**，即使 Agent 已有工具權限，也必須先列明精確異動與影響取得明確同意。未確認完整登入與 Session 能使用前，SSO 一律保持未完成狀態。
