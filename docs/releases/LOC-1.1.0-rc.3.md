# LOC 1.1 RC3 — Release Candidate

**版本：** `1.1.0-rc.3`  
**日期：** 2026-11-12  
**發版基礎：** GitHub `main` 的 commit [`9ada08ce2fbb`](https://github.com/EsotericVerse/moon-runes-pwa/commit/9ada08ce2fbb3220649309936dae0f0ee8e0ac93)（由 RC2.1 升版）。  
**狀態：** 預發布（Pre-release），不是 1.1 正式穩定版。

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
