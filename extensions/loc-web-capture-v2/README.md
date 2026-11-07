# LOC galaxy-link｜彩虹橋 — 獨立 Chrome MV3 Extension

**連接屬於你的文字銀河。**

LOC Galaxy 的中文統一稱為「銀河」。銀河可以呈現為時間長河、個人文字與地點地圖；Extension 是蒐集資料進入銀河的入口，而非限定某一種呈現方式。

LOC MCP 也稱為「彩虹橋（galaxy-link）」，兩者名稱一致但系統各自獨立，絕不共用 Session、Queue 或執行流程。

這是**重新建立**的 Extension，非舊 `loc-galaxy-link` 的延伸、替換檔案或登入改名。MCP 負責新對話紀錄，Extension 負責正在瀏覽的網站內容、IG／Threads 可見貼文、局部動態錄製，以及**已載入的**歷史對話。完整 IG／Threads ZIP／JSON 歷史匯入維持在 LOC 網站。

## 安裝與使用
Chrome → `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選取本資料夾。右鍵選單可擷取目前網頁／選取文字；工具列 Popup 可擷取、選取區域、開始／暫停／繼續／停止錄製及手動送出。

- 使用者手動點擊錄製後，content script 才使用 MutationObserver 與 IntersectionObserver 追蹤目前選定區域內已載入的卡片。停止立即斷開監聽；不跨網站爬取、不自動捲動、不繞過登入限制。
- 一般文章使用 DOM 的 main/article、標題與可見文字及超連結；歷史對話頁嘗試辨識有角色標記的已載入訊息。只保證擷取實際載入的資料，不聲稱完整歷史；沒有可辨識的訊息時不擷取，不會把聊天網站導覽文字當作對話。
- 單一 IndexedDB Queue，依每筆擷取時選擇的目的 Scope 分批（不在傳送時改目的地）；每筆事件 UUID＋來源 URL，用穩定來源識別和內容 fingerprint 在本機去重。**10 次擷取或 600 KB** 啟動批次，最多 50 筆／600 KB／批。手動傳送不受門檻限制。
- 以「Scope＋穩定來源」識別送往 LOC 銀河短匯入的 `write_mode=append` 協定。由服務端負責 UID、冪等與同來源接續；收到完整的批次 ID 與所有來源 UID 回執才刪除 Queue。失敗保留 Queue，並暫停自動傳送；手動重試不刪本機資料。
- **不存 Session、Access Token、Refresh Token，不呼叫 Clerk／MCP，不定時續期、不開 OAuth Popup**。手動「開啟 LOC 網站授權設定」打開 `/extension/bridge/`；網站頁面提供「更新 LOC Auth」按鍵，只有按下時才核對現有登入，不在 Extension 執行憑證交換。
- 批次傳輸使用 `chrome.scripting.executeScript({world:'MAIN'})` 呼叫僅存在於 LOC 網站 `/extension/bridge/` 的 `window.__locGalaxyLinkImport`。網站呼叫既有 `dbAuthClient.shortImport` → LOC SQL Gateway → Authority 簽發 Scope `write` delegation → `kind=short-import` Kysely 交易。**Extension 不接觸網站 OAuth Token**，不發明第二條 `/v1/import/short` 路由。
- 伺服端沿用 `app/loc/import/short-append-service.mjs` 及 `supabase/functions/loc-kysely/index.ts` 已存在的寫入邊界；`/extension/bridge/` 沒有編輯模式前置登入要求，真正寫入由 Authority 逐次核驗指定 Scope 的 `write` grant。沒有網站頁面、Session、Scope grant 或完整 UID 回執，一律保留 Queue。
- 最終上線需完成：Chrome 真實操作、動態頁面錄製、斷網重送、網站 Session 寫入、UID 接續與跨來源冪等的端到端測試。模擬檢查不等於正式落庫。

## 來源參考和授權
參考 Omnivore（`web-extensions/extension-v3`）的正文抽取規劃、Karakeep（`apps/browser-extension`）的擴充功能互動、ChatGPT 匯出工具的已載入對話 DOM 解析，以及 Checkly Headless Recorder 的選區／錄製狀態機。本實作沒有複製 AGPL 原始碼，也沒有包含舊版 Extension Auth／Queue 程式。若未來直接引入第三方程式，先檢查版本與授權條款。
