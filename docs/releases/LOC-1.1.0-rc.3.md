# LOC 1.1 RC3 — Release Candidate

**版本：** `1.1.0-rc.3`  
**日期：** 2026-11-12  
**發版基礎：** GitHub `main` 的 commit [`9ada08ce2fbb`](https://github.com/EsotericVerse/moon-runes-pwa/commit/9ada08ce2fbb3220649309936dae0f0ee8e0ac93)（由 RC2.1 升版）。  
**狀態：** 預發布（Pre-release），不是 1.1 正式穩定版。

## RC3 核心摘要（2026-11-12）

RC3 以**模組整併、解耦與高效能 Portable 架構**為主軸，依目前專案進度歸納：

- **模組去重**：合併重複實作，減少多套相同功能並存。
- **模組與服務分層**：Portable 核心解除對特定 PostgreSQL Driver／外部認證服務的硬性依賴；**Better Auth 保留，作為 LOC Auth 內部的 OAuth／Session 認證模組**，並非待移除的外部服務。`pg` 仍供現有 LOC Auth PostgreSQL 持久化使用，不等同於 Portable 核心必須綁定 PostgreSQL。
- **套件整理**：更新使用中的 packages、移除多餘依賴與重複安裝項目，並收斂模組責任。
- **Portable 進度**：目前估計**約 80%**；依現階段架構盤點，目標／狀態為**RPC、Edge、Migration 依賴歸零**。此為目前開發盤點說明，不當成已完成全倉庫零殘留的獨立稽核結果。
- **模型整合待完成**：`Zod × ZenStack ZModel × Kysely` 還有最後一部分需要對齊，包含資料模型、型別契約與讀寫路徑。
- **查詢效能優化**：持續移除大量／重複／週期性查詢，降低 Auth 與資料讀取的過度請求，優先使用既有模型與快取機制；實際效能仍需以執行紀錄驗收。

**架構層級：** LOC MCP 是獨立的工具／委託與 Provider 政策層；LOC Auth 使用 Better Auth 核發及驗證 OAuth 身分。MCP 需驗證 LOC Auth 憑證，但不屬於 Better Auth，MCP Tool 政策與 Galaxy Scope 授權亦非由 Better Auth 決定。現行 MCP 仍直接使用 `better-auth/oauth2` 驗證函式，私人讀取仍有 `userinfo` 請求；這是後續效能去重的待檢項，不可誤記為完全解耦。

**RC3 定位：** Portable 架構進入收斂階段的預發布版本；並非宣告上述剩餘整合與效能驗收已全部完成。

## 版本範圍

本版採用截至上述 commit 已合併至 `main` 的現有程式碼，不額外引入功能性改動。此次升版同步更新 `package.json` 及 `package-lock.json`，保留 RC2.1 歷史紀錄。

近期已合併的修正包括：

- PR #1444：修復首頁儲存後未返回，以及 managed action 傳送空 Scope ID。
- PR #1445–#1446：對齊 Neon ZModel、SchemaDef 與實體資料欄位的 `CHAR(8)` UID 契約。

其他功能與測試結果應以各個已合併 PR、CI 紀錄及正式環境實際驗收為準；此文件不宣稱所有功能已完成驗收。

## 發行與部署界線

- 本次 Git 提交僅更新版本宣告與此發行紀錄；不新增 Preview PR 或調整部署 workflow。
- GitHub `main` 更新後，正式部署狀態需要另外核對成功與 commit SHA，不能僅憑版本宣告視為已部署。
- 若要正式建立 GitHub `v1.1.0-rc.3` tag／Pre-release，須另外完成標籤與 Release 發布；此文件本身不等於 GitHub Release。
- iOS 未簽署 IPA 仍須手動建置及驗證，不能由本次升版推定資產已存在。

## 驗收清單

1. `package.json`、`package-lock.json` 的版本均為 `1.1.0-rc.3`。
2. 核對必要的程式檢查、CI 與 Cloudflare 正式部署結果。
3. 依需要另外建立 GitHub 預發布 Release 與手動 iOS 發行資產。
