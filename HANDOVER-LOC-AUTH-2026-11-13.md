# LOC Auth／MCP Gateway／Extension 交接

更新：2026-11-13

## 先讀：使用者已確認的現況與界線

- 使用者再次確認：LOC Auth 全部設定已完成，並且使用 Neon；Cloudflare 相關設定與 Neon Auth tables 都已完成。不要重做設定、重建 tables 或遷移資料層。
- 使用者要求移除的是 Neon API／provider 整合。這不等於刪除 Neon tables，也不等於移除 Auth 使用的 PostgreSQL 連線。
- 本機程式目前以 `@neondatabase/serverless` 的 `Pool` 連接 `LOC_AUTH_DATABASE_URL`，由 Kysely `PostgresDialect` 和 ZenStack Better Auth adapter 使用 Neon PostgreSQL。這是實際資料庫連線，不是 mock 或假 dialect。
- `LOC_AUTH_DATABASE_URL` 是資料庫連線，不是 Neon 管理 API key。移除 Neon API/provider credential 不會自動停用這條資料庫連線。若要停用整個 Neon 資料庫，必須先有使用者指定的既有替代儲存與搬遷方案；不得自行推導為建立新空間。
- 使用者明確糾正：不得自作主張新增 D1、R2、T4 或任何新資料空間。前一輪提出 D1 遷移是錯誤岔路；本次交接前沒有建立 D1、沒有變更 Neon 資料、也沒有做新的 Cloudflare 部署。
- D1 與先前的 Object／物件儲存路線已讓使用者耗費多日且未解決；這是已知失敗、造成大量時間成本的路線。不得重建、重用或再把它當成替代方案推進。
- 使用者已花大量時間排除 503；不要重構資料層或改動已完成的 Cloudflare／Neon 設定。Provider UI／選單也不是本次要改的範圍。

## Git 狀態

- Repo：`/workspace/moon-runes-pwa`
- Branch：`codex/loc-auth-mcp-extension-20261113`（由 `work` 建立）
- HEAD：`3f6a2e40b90da8ab58792cfc8d651fbf9536f842`
- 建 branch 時 `origin/main` 與基底 HEAD 相同；沒有 merge 到 main。
- 原有 29 個 tracked 檔案修改與 3 個新增實作檔案，加上本交接文件，放在此分支。
- `scripts/test-mcp-extension-sso.mjs` 保留在原工作區但不放進本分支；先前的 4 項測試結果是該工作區的歷史紀錄。
- 使用者明確要求只開 branch，不 merge 到 main。
- Repo 版本為 `1.1.0-rc.3`。合併前需先逐檔檢視差異與版本，不得用舊版本覆蓋 main。

## 未提交工作內容

- 管理介面與多語系：`app/i18n/sections/admin.*`、`app/i18n/sections/uiExtra.globalSettings.*`、`app/loc/GlobalSettings.jsx`、`app/loc/views/admin-panels/EnterpriseAuthReserved.jsx`、`app/modular/edit-dock.jsx`。
- Auth／OAuth／MCP：`workers/loc-authority/auth.mjs`、`workers/loc-authority/index.mjs`、`app/loc/auth/loc-browser.mjs`、`app/loc/mcp/upstream-oauth.mjs`、`app/loc/mcp/extension-sso.mjs`（新增）、`functions/api/mcp-provider-callback.js`、`functions/api/mcp-provider-extension.js`（新增）。
- Extension：`extensions/loc-galaxy-link/background.js`、`manifest.json`、`options.html`、`options.js`、`README.md`；`workers/loc-authority/extension-client.mjs`（新增）。
- 其他連動：`app/loc/db-client.mjs`、`app/loc/db-contract.mjs`、`app/loc/use-account.js`、`package.json`、`package-lock.json`、`public/_routes.json`、`public/extension/oauth/client.json`、`public/extension/oauth/config.json`、`public/login/index.html`、`scripts/probe-loc-native-auth.mjs`、`scripts/test-mcp-extension-sso.mjs`（新增）。

## 需求脈絡

- LOC Auth 是 LOC 的 MCP gateway／OAuth issuer；Cloudflare SSO 是上游登入身分。LOC Auth 管自己的使用者、session 與 OAuth 狀態。
- Extension 的目標是經 LOC Auth 登入一次，讓 Supabase／Neon 等 MCP 服務不要反覆要求使用者重做授權，並保留可查的呼叫紀錄。
- 目前 auth source 仍使用 Neon PostgreSQL 作為 Better Auth 儲存。不要把「移除 Neon API/provider」誤做成「重建 auth storage」；先確認要移除的 provider credential／連線點，再只處理該 API 整合。

## 目前已知驗證與部署紀錄

- 前一輪紀錄：`npm run check:syntax` 曾通過（699 個檔案、0 errors）；`node --test scripts/test-mcp-extension-sso.mjs` 曾通過 4 項；`npm run build:static` 曾完成（83 pages）。這些是先前結果，接手時如需驗收應針對目前工作樹重跑，不代表已部署端到端成功。
- 前一輪紀錄顯示 Auth Worker 的 Cloudflare SSO 版本曾部署；MCP gateway／Pages 的最終部署仍標記為未完成。接手時先查線上版本與部署紀錄，避免重複部署或破壞使用者已完成的 Cloudflare 設定。
- Neon tables 由使用者確認已存在。本次沒有執行 DDL、刪表、資料搬移或刪除任何 Neon credential。

## 接手順序

1. 先檢查 `git status` 與整份 diff，保留全部現有修改；不要 reset、checkout 覆蓋、清理或直接 merge。
2. 查明使用者所說的 Neon API/provider credential 在目前設定中的確切位置，確認移除它不會移除 `LOC_AUTH_DATABASE_URL`、Neon tables 或 LOC Auth 所需的 PostgreSQL 連線。
3. 以既有 Cloudflare SSO 設定、既有 Neon tables 和目前 503 修復為基礎，完成 Extension → LOC Auth → MCP gateway 的剩餘整合與紀錄驗收。
4. 使用者目前只授權此分支收尾，不授權 merge main。後續若需發布到 main，等使用者另行指示；不要自行新增資料空間或更換儲存架構。
