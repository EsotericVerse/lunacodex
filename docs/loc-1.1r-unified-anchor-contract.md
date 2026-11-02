# LOC 1.1R｜統一 Anchor 正式欄位契約（2026-11-02）

## 範圍

僅整合 `silver.lo3rwang_anchor`。原 `_time`、`_trace`、`_keywords`、`_galaxy_media` 來源表保留；其他 Scope 與 Neon 不在這次變更範圍。

實體欄位只有：`uid`（大小寫敏感、8 碼主鍵）、`type`、`title`、`description`、`invisible`、`attr`（JSONB）。**`label` 已淘汰，不得恢復成另一個欄位，也不得再寫入。**

`type` 唯一判斷種類，不建立第二套 `kind`；`description` 保存說明／媒體原始 meta_tags。不同種類的 `attr` 僅含該種類需要的資料。

| type | `attr` 資料鍵 | 含義 |
| --- | --- | --- |
| `date` | `date` | 日精度日期（YYYY-MM-DD） |
| `period` | `uid` | 日期定錨八碼 UID 陣列；既有 `date` 值保留，新增時不強制複製推導日期 |
| `era` | `period` | Period 八碼 UID 陣列；既有 `date` 值保留，新增時不強制複製推導日期 |
| `point` | `longitude`、`latitude`、`location` | 真正存在的座標／地點文字 |
| `path` | `point` | Point UID 陣列 |
| `trace` | `point`、`path` | 對應的 Point、Path UID 陣列 |
| `category`、`class` | `uid` | 下層八碼 UID 陣列 |
| `group` | `uid`、`total` | Item 八碼 UID 陣列、已保存統計值 |
| `item` | `keyword`、`total` | 判斷詞字串陣列、已保存統計值 |
| `image`、`video`、`rune`、`suno` | `url`、`date`（僅現有實際資料） | 真實來源 URL 與既存日期；不推導 ZIP 路徑為 URL |

**既存的 `label` 不能倒灌回 `attr`：** 部分舊 `label` 留有四碼關聯，而 `attr` 已存轉換後的八碼 UID，應以 `attr` 為準，避免污染已完成的關聯。

## 資料存取

- `app/loc/unified-anchor-compat.mjs` 將舊 Time／Trace／Keyword／Media 介面轉成實體 `attr` 讀寫，不查詢 `label`。
- 新增統一 Anchor 的 UID 一律為八碼；同一物理表跨 `type` 共用 UID 空間。
- 讀寫既有 JSONB 時保留其他有用的同筆屬性，不回存 `version`、`segments` 等無效時間快照。
- 關鍵詞、音樂及痕跡相關 RPC 必須直接使用 `attr` 的鍵，不得使用舊的 `label::jsonb`。
- `silver.lo3rwang_galaxy.media_link` 是文章到媒體的 **UID 陣列**，不等同於媒體 URL，也不存到 `attr`；媒體 URL 是媒體 Anchor 的 `attr.url`。
- 符文、Suno 與媒體 UID 的關聯需用真實資料核對；不得用檔名、內文或 ZIP 附件路徑推導不存在的網址。

## 匯入規則

- 只有文章有地點或獨立打卡事件，才建立／沿用同一天 `date` 定錨；普通文章日期不自動建立時間定錨。
- 週年建議（aniversary）是獨立的虛擬功能，從不參與匯入及實體 Anchor 寫入。
- 原始文章 `url` 僅對應文章來源資料的 `url`；內文網址不作文章 URL。
- 已匯入媒體的 `media_link` 應保持真實媒體 UID，不能以文章 URL 或內文替代。

## 驗證

每次切換須核對欄位、CHECK 約束、RPC、相容轉接程式、匯入定錨測試及 Cloudflare 正式部署。避免只更改資料庫，留下程式仍引用已移除欄位的狀態。
