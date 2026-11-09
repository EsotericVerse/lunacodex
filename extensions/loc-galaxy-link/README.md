# LOC galaxy-link｜LOC 彩虹橋

**唯一 Chrome Extension：** 於 `chrome://extensions/` 載入 `extensions/loc-galaxy-link/`。

本擴充功能整合 LOC Auth OAuth + PKCE S256、Readability 一般網頁、選取文字、區域擷取、Instagram／Threads 已載入貼文、ChatGPT／Claude 已載入的逐則對話，以及選區動態錄製／暫停／恢復／停止。右鍵「LOC 彩虹橋｜galaxy-link」即可選擇操作，工具列 Popup 也可操作，含 AI 回覆預設關閉。

僅使用既有 IndexedDB `loc-channel1-queue` 與 `pending` store，版本 2 新增 `acknowledged` 去重存儲；原有未送 Queue 不清空、不搬移、不換帳號。所有功能共用這一個 Queue、這一組 LOC Auth 與短匯入 API。滿 10 次擷取或累積約 600 KB 送出，手動可提前送出；依擷取當下的 Scope 分批，各篇以來源為單位持續 Append，完整收齊批次／UID 回執後才刪 Queue。禁止匿名、覆寫文章及跨 Scope 混合批次。

非預設 Scope 需要 LOC Auth Discovery 宣告 `loc_import_scope_routing: query-v1`；部署前不可將這些內容誤寫到預設 Scope。程式不使用舊網站 Session Bridge、SQL Gateway、Clerk、Supabase Auth 或 Neon Auth。

**既有另一個已安裝 Extension 注意：** Chrome 不允許新 Extension 直接讀取不同 Extension ID 的 IndexedDB。若舊的 `loc-web-capture-v2` 已有待送資料，請先從舊版送達、確認 UID 再卸載；本倉庫不再提供第二套獨立 Extension。瀏覽器尚未載入的對話不會自動取得。

## 操作入口（0.2.1）

請直接在**網頁內容上按右鍵**，打開 Chrome 原生「LOC 彩虹橋｜galaxy-link」子選單，再選擇整頁、選字、選區或錄製及其控制指令。工具列圖示僅打開設定頁（LOC Auth、Scope、是否包含 AI 回覆、Queue），**不提供擷取 Popup**。升級不改原本的 Chrome Extension ID、IndexedDB 名稱或儲存的 Queue。
