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

## 四大公開版面整合（已部署；互動驗收持續）

> 2026-11-03，PR #968。公開 UI 的程式與功能契約紀錄；GitHub 合併、Cloudflare 正式部署及使用者驗收須分別以實際狀態判斷。

- 文化保留實際時間長河與點入才載入的文章清單，統一公開卡片樣式及排序控制。
- 統計保留圖表類型、維度、時期、來源的自訂篩選，文章卡片套用同一共用樣式。
- 搜尋獨享命中詞醒目標記及前後文摘錄；其他三個功能的文章列表不執行此摘錄。
- 痕跡保留地形圖、位置選取、文章／時間／統計切換，文章清單共用版面。
- 四個公開功能共用容器尺寸、文章卡片、互動焦點及手機響應式規格；只使用既有 Theme CSS tokens，不引入第二套固定配色。
- 管理選單、管理搜尋及其他編輯介面不在這次視覺修改範圍，資料庫結構與 RPC 不變。

**程式驗證（2026-11-03，PR #968）**：在完整 LOC 專案 workspace 執行 `npm run check:syntax`，826 檔、0 語法錯誤；`postcss.parse` 驗證 45 條 CSS 規則；`test:bootstrap` 執行 482 項，429 通過、53 失敗。同步以 `main` 同條件執行 482 項、429 通過、53 失敗，失敗項目完全相同，**PR 新增失敗為 0**。目前 package scripts 未設定專屬 `lint` 指令，不宣稱已通過 lint；前端實際互動與 Cloudflare 正式部署仍須獨立驗收。

### 痕跡公開訪客讀取修正（2026-11-03）

- 以訪客開啟公開痕跡地圖時，Point／Path／Trace 的列表和點位明細改由匿名唯讀連線取得；不再因缺少 Clerk Token 導致地圖資料讀取失敗。
- 仍由既有 Supabase RLS 僅顯示 invisible=false 的公開地點；明確要求 includeHidden 的管理讀取維持經 Clerk 驗證的通道。不涉及 Schema、RPC 或 RLS 修改。
- 驗證：npm run check:syntax 828 檔案零錯誤；新增測試先失敗再修復通過；Bootstrap 483 項、430 通過、53 項為基線既存失敗，與更新前 Main 的 482 項／429 通過／53 失敗比較，新失敗 0。正式訪客地圖實測與 Cloudflare 部署需於合併後另行確認。

### LOC Clerk 登入頁視覺整合

- 獨立 `/login/` 登入頁改為 LOC 既有日夜 Theme 語意色系、柔和圓角、環形月象與雙欄／手機單欄的響應式版面；保留 Google、Email、Clerk 原生輸入及驗證流程。
- 登入頁不再包覆多層硬邊框，Clerk 表單寬度隨容器收合，並提供繁體中文引導、登入後核驗及清楚的返回入口。鍵盤焦點和減少動態效果設定均保留。
- 因 AppShell 不跨路由持久化單一 Scope 的臨時 Theme 選擇，獨立登入頁遵守 LOC 日間 theme-7／夜間 theme-1 預設，不將登入頁色彩另存為新的個人設定。
- 只調整畫面及 Clerk 的外觀／介面文字設定，`validReturnPath`、Clerk Session Token、LOC Authority 驗證、寫入權限與登出行為保持不變。需以實際桌機／手機瀏覽器和現有驗證測試核實。

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
