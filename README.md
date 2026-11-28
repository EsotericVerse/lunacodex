# LOC｜Luna Codex

LOC 是語言委託框架，提供多 Scope 內容管理、搜尋、統計、文化時間軌跡。

LunaRunes（月之符文）提供 66 枚符文圖鑑、抽牌、每日符文與互動遊戲。

## 架構與進度

LOC 的程式架構與技術契約以目前原始碼、相鄰註解及測試為準；歷史架構紀錄可透過具權限控管的 Galaxy `55970CD5`（site=LOC）查閱。

LOC 現行架構、功能契約與待辦統一維護於具權限控管的 Galaxy `55970CD5`；歷史設計、過去的文件與工程紀錄由 GitHub PR／Commit 歷史追溯，不在 Galaxy 重複歸檔。公開程式碼、版本記錄和必要操作文件仍保留於 GitHub。

## 公開瀏覽四大功能

四大功能共用 LOC 的文章卡片、清單與排序操作，並且全部跟隨使用者目前選擇的 Theme。

- **文化／時間長河**：先從時代、期間與日期的河道定位，再按需展開該區間文章；文章中的時間關聯可以回到河道。
- **統計／自訂圖表**：選擇統計維度、時間與圖表類型，再查看對應文章清單。圖表設定由統計頁提供，不套用搜尋摘錄。
- **搜尋／關鍵詞**：輸入詞語並調整時間／來源篩選；只有這裡的文章列表提供命中字詞前後文與醒目標記。隱藏與可搜尋權限沿用既有設定。
- **痕跡／地形圖**：地圖為主視覺；選擇定錨點或路線後，於地點內容中切換文章、時間長河與統計。

文章為四種體驗的共同閱讀入口；既有時間、空間、統計與關聯連結保持原有功能。管理選單及管理編輯介面另行維護，不適用本次公開樣式統合。

## Lucus 架構與 LOCLucus 關係圖

**Lucus = Lucas + Locus = Lucus**。這是作者定義的特殊拉丁文字，意為「光之時空定錨點」；在概念意象上，是 Universe Tree 上的神聖樹林。Lucus 不只是將 Anchor 換名，也不等同於單一資料表或單一功能模組。

整體的未來演化關係為 **Galaxy → Universe → Universe Tree**；Lucus 位於 Universe Tree 上，以細微、粒子化的時空定錨元素建立跨節點關聯，支援相對應的連接與轉換。這是未來架構擬定，並非目前已完成的 Universe Tree、粒子引擎或跨系統轉換實作。

LOC 的專屬關係圖固定為 **LOCLucus**，四個功能面向各自對應一種 Lucus：

| LOCLucus 面向 | Lucus 類型 | 領域 | 既有關係 |
|---|---|---|---|
| Culture | TLucus | 時間 | Era → Period → Date |
| Trace | LLucus | 空間 | Trace → Path → Point |
| Statics | KLucus | 關鍵詞 | Category → Class → Group → Item → Pattern |
| Search | SLucus | 來源／網站 | Universe → Galaxy → Domain → From |

這四個分支是 LOC 對 Lucus 架構的領域化關係，不是四套互不相干的定錨系統。現有 UID 與資料讀寫仍由 LOC 負責；本關係圖不新增資料表或 migration。未來跨系統連接與轉換使用 **Lucus 架構 + LunArcus 協定**；協定資料格式與粒子層細節尚屬未來設計。
