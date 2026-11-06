# LOC 網頁擷取與錄製 — 獨立 Chrome MV3 Extension

這是**重新建立**的 Extension，非舊 `loc-galaxy-link` 的延伸、替換檔案或登入改名。MCP 負責新對話紀錄，Extension 負責正在瀏覽的網站內容、IG／Threads 可見貼文、局部動態錄製，以及**已載入的**歷史對話。完整 IG／Threads ZIP／JSON 歷史匯入維持在 LOC 網站。

## 安裝與使用
Chrome → `chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選取本資料夾。右鍵選單可擷取目前網頁／選取文字；工具列 Popup 可擷取、選取區域、開始／停止錄製及手動送出。

- 使用者手動點擊錄製後，content script 才使用 MutationObserver 與 IntersectionObserver 追蹤目前選定區域內已載入的卡片。停止立即斷開監聽；不跨網站爬取、不自動捲動、不繞過登入限制。
- 一般文章使用 DOM 的 main/article、標題與可見文字及超連結；歷史對話頁嘗試辨識有角色標記的已載入訊息。只保證擷取實際載入的資料，不聲稱完整歷史；沒有可辨識的訊息時退回一般頁面擷取。
- 單一 IndexedDB Queue；每筆事件 UUID＋來源 URL，用穩定來源識別和內容 fingerprint 在本機去重。**10 次擷取或 600 KB** 啟動批次，最多 50 筆／600 KB／批。手動傳送不受門檻限制。
- 以穩定來源識別送往 Galaxy Short Import 的 `write_mode=append` 協定。由服務端負責 UID、幂等與同來源接續；收到完整的批次 ID 與所有來源 UID 回執才刪除 Queue。失敗保留 Queue，並暫停自動傳送；手動重試不刪本機資料。
- **不存 Session、Access Token、Refresh Token，不呼叫 Clerk／MCP，不定時續期、不開 OAuth Popup**。手動「開啟 LOC 網站／更新 OAuth」只是開啟 LOC 網站的正常登入／設定頁，不在 Extension 執行憑證交換。
- 批次傳輸是用 `chrome.scripting.executeScript({world:'MAIN'})` 在使用者已開啟的 `https://loc.lo3rwang.cc/` 網站分頁執行**同源** `POST /v1/import/short`（`credentials:'same-origin'`）。不讀取、複製或傳出網站 Cookie。沒有 LOC 分頁／網站 Session／短匯入服務端時安全失敗並保留 Queue；**不會重新登入或反覆呼叫 Auth**。
- 若 LOC 當前尚未提供以網站 Session 進行身分與 Scope 核驗的同源 `/v1/import/short`，此版本的擷取及 Queue 可用，但**真實 Galaxy 寫入尚不可宣稱通過**。後端必須先驗證 Cookie Session、Scope 寫入權限、防 CSRF／同源來源，並按現有 `short-append-service` 實作批次回執，不能信任前端自填的 subject／scope。
- 最終上線需完成：Chrome 真實操作、動態頁面錄製、斷網重送、網站 Session 寫入、UID 接續與跨來源冪等的端到端測試。模擬檢查不等於正式落庫。

## 來源參考和授權
參考 Omnivore（`web-extensions/extension-v3`）的正文抽取規劃、Karakeep（`apps/browser-extension`）的擴充功能互動、ChatGPT 匯出工具的已載入對話 DOM 解析，以及 Checkly Headless Recorder 的選區／錄製狀態機。本實作沒有複製 AGPL 原始碼，也沒有包含舊版 Extension Auth／Queue 程式。若未來直接引入第三方程式，先檢查版本與授權條款。
