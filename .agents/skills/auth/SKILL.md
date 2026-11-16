---
name: auth
description: "LOC 的 OAuth token 驗證、Session 信任、Scope 及 api.manage 授權；Auth／SSO Provider 的維護在 LAS。"
---

# LOC Identity／Business Authorization

**LAS 擁有 Better Auth、Cloudflare Access SSO、OAuth/OIDC Provider 與 Session 發行**；由既有 `lunarcus` Worker 的 `auth.lo3rwang.cc` 供應。LOC **不是第二套 Auth Server**，不可在 LOC 新建 Auth Worker、SSO callback、憑證或身份資料庫。

LOC 的工作是**驗證已有的身份憑證，並獨立決定自己的資料權限**：
- 核對 token 的簽章、issuer、audience、期限與身份對應；網站 Session 和 LAS MCP bearer audience 必須區分，不能直接共用或把成功登入當 grant。
- 用 LOC 自己既有的 Scope／`api.manage`／Galaxy、Z-Model 政策決定讀取、寫入、匯入與編輯能力。SSO 人員管理不等於每個 LOC 使用者都須註冊。
- `/api/las-native` 是固定操作的 LAS → LOC 業務入口，不能接受 caller 指定 DB、SQL、service token；網站 cookie 不應被 MCP 代理轉送。
- 若錯誤發生在 LAS 的 `sign-in/sso`、OIDC callback、token／discovery，交給 LAS `auth`／`oauth-oidc` Skill；LOC 只追自己收到憑證後的授權與會話整合。

逐層驗證：LAS token 可用 ≠ LOC Scope 有權限 ≠ 業務操作成功。先查現行程式、狀態碼與有意義的最小負向測試，不碰 Cloudflare Secret 值，不將登入失敗一律歸因於 LOC SQL。
