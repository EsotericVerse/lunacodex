---
name: auth
description: "身份、SSO、OAuth、OIDC、Session、驗證及授權邊界；保留 LOC 現有 Cloudflare SSO 與 Better Auth，不自動變更提供者。"
---

# Auth / Identity — 身分與授權入口

處理登入、SSO、OAuth2/OIDC、Session、授權與 API 存取時，先看目前 LOC Auth、Cloudflare SSO 與現行程式碼。不可因資料庫或 MCP 同時出現便強制載入所有資料庫 Skill。

Better Auth 是模組，不是「每個 Better Auth Plugin 就需要一份 Skill」。除非正在實作其特定功能，否則不要連動載入密碼、組織、雙因素或 Neon Auth 的專用指引。已完成的身分提供者和權限策略不得自行替換。

需要特定 API 版本或疑難排解時，從 `.agents/SKILL-LINKS.md` 選一份最貼近問題的固定版本資料，必要時確認官方最新文件。
