# LOC 通用 Anchor RPC 契約

## 架構決議（2026-11-03）

**求同存異**：所有一般 Scope（包含 `lo3rwang`、`lrunes`）共用同一套 Anchor 資料讀寫規則。Scope 名稱不決定邏輯分支，`scopeid` 決定資料歸屬，`type` 決定資料類別，`attr jsonb` 承載類別特有的結構。符文首頁、每日符文行事曆、遊戲可維持專用功能；符文內容、一般文章、時間、空間、關鍵詞、媒體及一般統計仍應與其他 Scope 通用。

### 主入口

```sql
silver.scope_type_attr(p_scope_id text, p_type text, p_attr jsonb)
```

`p_scope_id` 以 `silver.manage.anchor_table` 查找 `silver.{scopeid}_{anchor_table}`，驗證該 Scope 的權限。`p_type` 使用統一類型集合：
`date, period, era, point, path, trace, image, video, rune, suno, category, class, group, item`。

`p_attr` 是 **RPC 請求封套**，不是原封不動的資料列 `attr`：

```json
{"op":"read","where":{"date":"2026-11-03"},"limit":100,"offset":0}
```
```json
{"op":"insert","uid":"Ab12Cd34","title":"名稱","description":"","invisible":false,"data":{"date":"2026-11-03"}}
```
```json
{"op":"update","uid":"Ab12Cd34","data":{"date":"2026-11-04"}}
```

- `data` 才對應資料列的 `attr jsonb`；`uid/title/description/invisible` 仍是既定通用欄位，不移入 `attr`。
- 目前主入口提供 `read/insert/update`；`delete` 會拒絕，須由具關聯檢查的領域操作處理。更新 `data` 是整個 JSONB 物件替換，非部分合併。
- 權限由資料庫驗證；公開讀取不回傳隱藏項目，也不讀取私有關鍵詞類型；非管理者禁止寫入。
- `attr` 的類型鍵值由各 Anchor 資料表的 CHECK 保證。符文 `attr.rune` 的資料結構是既有必要差異，不代表另一套通用 CRUD。

### 索引與資料表不動

- `{scopeid}_galaxy`：`uid` PK、`date` B-tree。
- `{scopeid}_anchor`：`uid` PK、`type` B-tree。
- 不新增 `attr` GIN、額外 B-tree、暫存表或觸發器。通用 RPC 不需新表。
- `lrunes_daily` 獨立保留，僅在設定顯示行事曆，不進一般統計。
- `loc` 是 Group 設定與統合功能，**不是**一般 Scope Anchor；`_scope_group(groupid,type)` 尚未授權進行，不在本次實作範圍。

### 遷移現況與退役規則

- 已建立資料庫主 RPC；客戶端統一入口：`scopeTypeAttr(scopeId,type,attr,{write})`，在 `app/loc/db-client.mjs`。
- 既有相容層 `unified-anchor-compat.mjs` 與 `db-contract.mjs` 尚有歷史命名與 Scope 特例，**沒有全部改接主 RPC**；`lrunes` 的舊四表已於 2026-11-03 通過資料驗證並刪除，`lrunes_anchor` 與 `lrunes_daily` 保留。
- Timeline 寫入已共用 `apply_scope_point_links`，舊入口暫為轉接。複雜的地點合併、文章關聯更新、統計聚合應保留少數領域 RPC，但不得分別為 `lo3rwang`、`lrunes` 寫同質實作。
- 改寫每個呼叫端後，需先驗證 CRUD 權限、UID 大小寫、隱藏狀態、關聯更新與資料等價，再移除其轉接 RPC；**不得因新 RPC 已存在就直接刪除仍被呼叫的入口**。
- 變更 RPC 或資料結構均須同步修改此文件及測試。

### 公開與管理者呼叫

```js
import {scopeTypeAttr} from './db-client.mjs';
const points=await scopeTypeAttr('lrunes','point',{op:'read',limit:100});
const updated=await scopeTypeAttr('lo3rwang','date',{
  op:'update',uid:'Ab12Cd34',data:{date:'2026-11-04'}
},{write:true});
```

相關遷移：`20261103075000_scope_type_attr_rpc.sql`、`20261103073000_shared_scope_point_writes.sql`。

### RPC 整併紀錄（2026-11-03）

- **PR #936**：統一關鍵詞 Class 分享／目錄、摘要、共享匯入、空間密度、多媒體 EXIF 與分析 RPC 的 Anchor Scope 分流。
- **PR #937**：統一文章地點補寫／預覽、Timeline 預覽、搜尋摘要、關鍵詞建議、點位別名讀寫、點位合併、LOC 聚合統計。點位合併在單一資料庫交易內修正文章 `place_id` 及 `path/trace attr.point`。
- **本批**：`new_keyword_tree_uid(scope)` 僅使用 `{scope}_anchor.uid` 的 Base62 UID8，不再讀四碼舊 Keywords 或 staging 表。
- 不屬於同質 Anchor CRUD 的 `api.provision_scope`／`api.delete_scope`（Scope 生命週期）、`read_music_style_tree`（作者音樂分類）暫保留領域用途。前者的建表 LIKE 樣板仍參考現有實表，不表示執行時 Scope 讀寫有兩套邏輯。
- SQL RPC 通用化**不表示所有前端呼叫端已切換到 `scope_type_attr`**；舊入口的安全刪除仍須完成相依檢查。
- 正式資料庫的 `lrunes_time/trace/keywords/galaxy_media` 四表已不存在，全部已存入 Anchor；不可再依歷史四表寫入。
