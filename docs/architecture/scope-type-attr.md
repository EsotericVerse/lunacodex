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
- 目前主入口提供 `read/insert/update/patch`；`delete` 會拒絕，須由具關聯檢查的領域操作處理。`update` 的 `data` 為整個 JSONB 物件替換；`patch` 使用 PostgreSQL `attr || data`，只更新頂層指定鍵值，不會清除其他鍵（不是遞迴深層合併）。兩者均由 Anchor CHECK 驗證合法屬性。
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
- Timeline 寫入已改由 `scope_type_attr(scopeid,'point',{op:'link',mode:'place_id',updates:[...]})` 單一入口轉接原交易；`apply_scope_point_links` 在新客戶端部署驗證前保留為內部相容交易函式。複雜的地點合併、文章關聯更新、統計聚合應保留少數領域 RPC，但不得分別為 `lo3rwang`、`lrunes` 寫同質實作。
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
- 不屬於同質 Anchor CRUD 的 `api.provision_scope`／`api.delete_scope`（Scope 生命週期）保留領域用途；已無執行期呼叫者的 `read_music_style_tree` 已退役。前者的建表 LIKE 樣板仍參考現有實表，不表示執行時 Scope 讀寫有兩套邏輯。
- SQL RPC 通用化**不表示所有前端呼叫端已切換到 `scope_type_attr`**；舊入口的安全刪除仍須完成相依檢查。
- 正式資料庫的 `lrunes_time/trace/keywords/galaxy_media` 四表已不存在，全部已存入 Anchor；不可再依歷史四表寫入。

### 通用 attr 局部更新（2026-11-03）

```js
await scopeTypeAttr('lrunes','point',{
  op:'patch',uid:'Ab12Cd34',data:{location:['台北','臺北']}
},{write:true});
```

`patch` 僅覆寫 `attr` 的**頂層鍵**；未列出的屬性（例如座標）保留。`update` 仍執行全物件取代，避免既有呼叫者語義改變。此操作不創建新索引、資料表或欄位，也不取代必須連動文章 `place_id` 的地點合併交易。兩個 Scope 使用同一 RPC。

### Timeline RPC 轉接退役（2026-11-03）

Cloudflare Pages `loc` production 部署 commit `54844ebf19ce8d88b52c1c4534a76e49c699d571` 成功；正式客戶端已直接呼叫 `silver.apply_scope_point_links(scopeid,updates,mode)`。經確認 GitHub main 的 Timeline 呼叫端已移除舊 RPC，Supabase 以 `DROP FUNCTION ... RESTRICT` 正式退役 `silver.apply_timeline_place_ids(text,jsonb)` 和 `silver.apply_timeline_missing_places(text,jsonb)`，保留共用點位寫入 RPC。執行遷移為 `retire_timeline_compatibility_rpcs_20261103`，倉庫紀錄於 `20261103125000_retire_timeline_rpc_wrappers.sql`。

### Timeline Point 補寫寫入整合

`scope_type_attr` 的 `type='point'` 支援 `op='link'`、`updates` 與 `mode`，在資料庫同一交易內委派既有 `apply_scope_point_links`，回傳 `{count}`。只有 Scope 管理者能寫入，整批 UID 和 Point 仍受原子驗證；不增加表或索引。前端 Timeline 補寫不再直接呼叫專用 RPC。正式部署新客戶端後，才能移除內部委派函式並將驗證與更新直接放進通用函式。

### Scope 建議讀取入口整併（2026-11-03）

- `scope_type_attr(scopeid,'item',{op:'suggestions'})`：僅限 Scope 管理者取得既有關鍵詞建議暫存（維持原本 text[] 內容，回傳 JSON 陣列）。
- `scope_type_attr(scopeid,'point',{op:'suggestions',limit:60})`：僅限已核驗身分與 Scope 管理者，從文章地點欄位讀取批次建議（仍以單次 SQL 聚合）。
- 對應前端已改用統一入口；退役 `read_scope_keyword_suggestions`、`trace_place_suggestions` 和無執行期需求的 `read_music_style_tree`。公開地點名稱搜尋與需原子更新的地點合併仍保留自身交易／RLS 邊界。

### PostgreSQL portable 身分與舊路由清理（2026-11-03）

- 仍由搜尋／地點批次與來源修正頁使用的三項原子操作保留原先 Scope 管理權限、預覽防呆與批次寫入流程；只將 Supabase Auth 專用的 UUID 身分判斷改用既有 `api.current_user_id()`（取經簽章 JWT 的文字型 sub，Kysely PostgreSQL 交易會設定相同的 claims）。因此 Clerk 及其他 PostgreSQL 供應者不需為此建立 Supabase Auth 帳號。
- 無程式、SQL、View、Trigger 相依的舊路由函式 `loc_public_routing_state` 已透過 `DROP ... RESTRICT` 退役，去掉資料庫中寫死的 Supabase 專案網址；連線位置與供應者核驗仍由可信任的 SQL Gateway 負責。
- 這是 **PostgreSQL 提供者可攜**，不代表 MySQL／SQLite 自動支援 PostgreSQL RLS 或儲存函式；後者仍須實作等效授權適配層。沒有複製資料到 Neon，也沒有增加欄位、表、索引或 RPC。

### 四表合一後的舊痕跡函式退役（2026-11-03）

- 已確認 `trace_normalize_place_name`、`trace_prevent_identity_change`、`validate_scoped_trace_map` 沒有程式呼叫，且沒有 SQL、Trigger、View、RLS 或其他物件相依；其歷史實作仍使用已淘汰的 `trace_type`、`route_list`、`anchor_list` 和四字元 UID，不屬於統一 Anchor 的 `(scopeid,type,attr)` 架構。已用 `DROP FUNCTION ... RESTRICT` 退役，未重建任何相同功能的 RPC。
- `domain_has_repeated_labels` 雖無前端呼叫，仍有正式資料庫約束依賴，因此**保留**；`manage_id_not_blocked` 是身份／Scope 管理相關檢查，不隨四表清理逕刪。
- 本批只移除真正無相依的舊 SQL，不變動路線、痕跡與文章定錨資料，亦不更動 PostgreSQL／非 PostgreSQL 的授權與交易介面。
