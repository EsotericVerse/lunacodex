# LOC 1.1 RC2.1 — Release Candidate

**版本：** `1.1.0-rc.2.1`  
**發版基礎：** 2026-11-02 的 LOC `main`，包含自 [RC2](https://github.com/EsotericVerse/moon-runes-pwa/releases/tag/v1.1.0-rc.2)（2026-10-24）以來已合併的修正。  
**狀態：** 預發布（Pre-release），**不是 1.1 正式穩定版**。

## 本版重點

本版主要完成 PR #880 的管理列表勾選整合與 PR #887 的 Scope 搜尋摘要收斂；其他修正詳列於下方。

- **文章功能與可見性**：Galaxy 文章的八項功能開關集中到 `able` JSONB；區分列表、搜尋、摘要及私人 MCP Scope 讀取的權限，並修復相關回歸（PR #874–#879）。
- **Clerk／LOC MCP**：改善 Scope 管理授權、私人 Galaxy 搜尋及 UID 讀取，降低重複身分核驗造成的等待（PR #863、#866、#870、#872、#877、#883）。
- **搜尋摘要**：文化／搜尋共用資料流程調整；搜尋文章總數、字數、日期範圍已移至各 Scope 的 `status.search`，移除集中摘要與舊版自動完成詞表（PR #753、#846、#857、#887）。
- **功能設定與管理入口**：文化、痕跡、統計、搜尋新增預設關閉的「管理者顯示全部」個人設定；搜尋與文化的編輯入口已有整合，實際編輯仍驗證權限（PR #852、#855、#880）。
- **匯入與 Anchor**：修復 Facebook、Threads、Instagram 等來源的 URL、打卡時間／地點、媒體關聯及 UID 處理；調整 Time／Trace／Media 的整合契約（PR #834、#836、#841、#847、#850、#853、#858、#862、#878、#886）。
- **介面與效能**：改善管理頁 Hero 重複、管理身分查詢次數與文化／統計資料快取（PR #873、#883、#884）。
- **架構紀錄**：開發架構與歷史 TODO 移入有權限控制的私有 Galaxy；GitHub 保留必要公開使用文件、程式與發行紀錄（PR #885）。

## 部署與發行界線

- **Cloudflare Pages `loc`**：GitHub `main` 成功合併後自動進行正式建置與部署，分支預覽部署停用；每次仍須確認 Cloudflare 實際部署的 commit SHA 與成功狀態。
- **GitHub Actions／GitHub Pages**：大型建置與發行工作流程維持手動觸發，不替使用者改為每個 PR 自動執行。
- **資料庫**：Supabase 仍是目前主資料庫；Neon 備援不在本次切換範圍內。
- **iOS**：仍提供**手動**產生未簽署 IPA 的流程，預計檔名 `LOC-1.1.0-rc.2.1-device-unsigned.ipa`。**沒有成功的 iOS workflow 與上傳資產之前，不可宣稱 RC2.1 IPA 已存在或可直接安裝。**

## 已知待驗收項目

- 統計與痕跡的管理列表完整查詢，以及隱藏文章在各功能頁的端到端可見性，仍須完成整合與操作驗收；勾選個人設定不授予資料庫管理權限。
- Facebook／Threads／Instagram 全量重匯、Time／Trace／Media 的 UID 關聯與資料品質，需要依真實來源檔進行大資料比對。
- Clerk 登入／登出、管理編輯、儲存取消、手機／iOS 互動及快取更新，需要正式環境與裝置回歸測試。
- 此文件記錄**已合併的程式功能**，不把 PR 合併、Cloudflare Pages 自動部署、Supabase Edge／Authority Worker 部署或真實使用者驗收混為同一狀態。

## 發行檢查

1. `package.json` 與 `package-lock.json` 版號一致，均為 `1.1.0-rc.2.1`。
2. 確認必要的語法／回歸測試，以及 Cloudflare Pages 正式建置狀態。
3. 建立 GitHub 標籤 `v1.1.0-rc.2.1` 及**預發布** Release（不可標記 stable）。
4. 若需要未簽署 iOS IPA，另行手動執行 `ios-device-build.yml`，驗證通過後才附上 Release 資產。

正式架構、內部 TODO 及逐 PR 工作進度，仍以私有 Galaxy 為唯一正式來源。
