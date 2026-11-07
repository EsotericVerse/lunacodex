# LOC Repo 目錄清查｜2026-11-08

本次工作單位是 **目錄**，不是 npm 套件。對應修復已先以 PR #1223 還原錯誤的 npm 清理（PR #1222）；此批 **未修改任何** `package.json`、`package-lock.json`、執行期程式、資料庫或部署設定。

## 掃描與保留依據

GitHub `main` 的完整 Tree（約 3,270 個路徑，`truncated=false`）用於盤點。以子樹內容、真實程式格式、已安裝依賴、入口和 `AGENTS.md`／`docs/agent-skill-routing.md`／`skills-lock.json` 判斷，不以未被 JavaScript import 當作 Skill 無用的理由。

| 目錄群 | 判斷 | 原因 |
| --- | --- | --- |
| `app/`、`services/`、`workers/`、`functions/`、`extensions/` | 保留 | Next.js 路由、Cloudflare Pages／Workers、SQL/MCP、Chrome Extension 入口與現役程式 |
| `zenstack/`、`cli/`、`scripts/` | 保留 | ZModel 契約、LOC CLI、建置與測試 |
| `assets/`、`pics/`、`public/` | 保留 | 圖像與網站/符文靜態資產，可能由動態路徑或建置腳本讀取，未證實無用 |
| `supabase/` | 保留 | 歷史遷移及現行相容服務；Portable 整合未正式切除時不得刪 |
| `.github/`、`.githooks/` | 保留 | GitHub Actions 和安全檢查 |
| `.agents/`、`.claude/` | 保留主入口 | Codex／Claude 各有技能發現路徑；相同內容不能單憑重複檔案便刪 |
| `docs/` | 保留 | 架構與交接證據 |

## 本批確認不適用、整個目錄移除

| 原目錄（均位於 `.agents/skills/` 下） | 文件數 | 原因 |
| --- | ---: | --- |
| `clerk-swift/` | 4 | LOC iOS 使用 Capacitor，Repo 唯一 Swift 腳本是準備 App icon，沒有 Clerk Swift SDK 整合 |
| `clerk-vue-patterns/` | 11 | 專案沒有 Vue 程式；Vue 樣板僅在該 Skill 內 |
| `clerk-react-router-patterns/` | 12 | 專案使用 Next.js 路由，沒有 React Router 專案 |
| `clerk-tanstack-patterns/` | 13 | 沒有 TanStack Router 專案 |
| `zenstack-migrate-from-prisma/` | 2 | 目前為 ZenStack V3 + Kysely，Repo 沒有 Prisma Schema／Migration 專案 |
| `zenstack-migrate-from-v2/` | 2 | 已使用 ZenStack V3，並無 V2 遷移流程 |
| `maplibre-mapbox-migration/` | 1 | 使用 MapLibre，Repo 無 Mapbox 原始程式或遷移入口 |

上述合計 **7 個目錄／45 個檔案**。同步從 `skills-lock.json` 移除 7 個對應項目；只刪除整個已不適用的技能目錄，保留同系其他技能。

## 明確保留的相鄰目錄

- `.agents/skills/threejs-react-three-fiber/`、`threejs-postprocessing/`、其餘 `threejs-*/`：使用者已明確要求保留 React Three 路線。
- `.agents/skills/remotion-best-practices/`：雖然主依賴清單沒有 Remotion，但目前 `docs/agent-skill-routing.md` 明確將其列為影音流程指引，未證實可刪。
- `.agents/skills/clerk/`、`clerk-nextjs-patterns/`、`clerk-react-patterns/` 以及仍可能服務相容 Auth 的技能：Portable／Auth 切換期間保留。
- `.agents/skills/zenstack-*/` 中現役 V3 的 Schema／Query／Policy 功能、MapLibre 核心技能：保留。
- `.claude/skills/` 下三份與 `.agents/skills/` 同內容的 Skill：兩套 Agent 的發現入口仍然有效，因此不做跨目錄刪除。

## 風險與驗證界線

這批刪除不會改變執行期依賴或 Next.js 的頁面路由。已核對 Git Tree 與技能索引，未找到上述七個技能目錄作為正式路由的引用；目錄名在其他來源主要出現在 `skills-lock.json`（已同步處理）。它們是 Agent 的非執行期文檔，而非 Node 模組。

完整本機 Git hooks、Next.js 建置、所有 Agent 的實際技能發現未在 GitHub Connector 中執行，因此不冒稱全面驗證成功。其他無法確認無用的目錄暫不刪除。
