### 官方 Kysely 版本與 Agent 文件（2026-11-04）

- 官方目前最新穩定版本為 **Kysely 0.29.8**（2026-11-01）；PR #995 已同步 `package.json`、`package-lock.json`、所有 Deno `npm:kysely@...` 版本引用。0.29.7 修正 controlled transaction 的競態／連線與 MSSQL JSON；0.29.8 修正 PostgreSQL rollback／aborted-commit。
- Kysely 官方推薦 AI 文件：[llms.txt](https://kysely.dev/llms.txt)、[llms-full.txt](https://kysely.dev/llms-full.txt)；專案本機使用 `.github/skills/kysely-portable-loc/SKILL.md` 指向官方文件及版本，不依賴第三方過時 Skill。
- 官方有 `Dialect`、`SchemaBuilder`、`Migrator`、`transaction`、`withPlugin`、`withSchema`，可以實作無 RPC 的 CRUD、Schema 與資料異動；但**沒有可取代 Clerk 驗證／LOC Authority 的內建登入系統**。官方的 `$pickTables`／`$omitTables` 只縮小 TypeScript 型別視野，不能當執行期權限檢查。
- 使用 Kysely **取代可替換的 SQL RPC** 是正確的可攜性方向；PostgreSQL RLS／Policy 與其他引擎的授權、JSON 資料型別和 DDL 差異，仍需要可信 Gateway 依既有語義處理，才能真的達到「連線與最小必要資料表」即可運作。
- 本次是原分支 PR 變更，尚未通過完整 `npm run check:syntax`、真實 Dialect／Clerk 整合與部署驗收；不得誤稱正式資料庫已同步或 RPC 已刪完。

### 身分驗證與 SQL 可攜性修正（2026-11-04）

- LOC 網站身份固定為 **Clerk + LOC Authority**，不再允許 Supabase Auth JWT 取代 Clerk 登入。PostgreSQL 以既有 `silver.manage()` 保持權限判定；非 PostgreSQL 透過 Kysely 讀取目標庫既有 `silver.manage` Registry 與 `silver.loc.blacklist`，比對經驗證的 Clerk email/subject，拒絕已封鎖帳號與未授權 Scope。
- 資料庫連線使用該資料庫自己的連線 Driver／認證（MySQL 可選 LDAP simple + TLS，SQL Server 可選 NTLM／Entra）；**資料庫驗證不等於 LOC 使用者登入**。MySQL Driver 更新至已修補的 `mysql2@3.22.0`。
- 原生 Kysely CRUD／UPSERT／transaction 優先使用 Dialect，不因 MySQL／SQL Server 缺少 PostgreSQL RLS 而一概拒絕；但對外公開文章的 `search/list/extract` 隱藏規則、Anchor 複合 JSON 查詢／關聯寫入、文化／統計與 Scope DDL 尚待逐引擎等價驗收。未證明安全等價前仍拒絕這些操作，不可繞過授權。
- 歷史的獨立 `neon-primary.mjs`／Neon Data API 備援仍含 Neon Auth token 流程，**不在目前預設 Clerk 登入路徑中**；若要求 Neon 備援完全不依賴 Neon Auth，必須先配置獨立可信任 Kysely Gateway 及其資料庫權限，再切換該備援傳輸。當前不能宣稱備援已完全解耦。
- 回歸檢查：`scripts/test-kysely-clerk-only-auth.mjs`、`scripts/test-kysely-portable-access.mjs`；正式 `npm run check:syntax` 與完整 Dialect/Clerk 整合測試仍需執行，不得以獨立模擬取代。


### Kysely 跨 SQL 引擎可攜性（PR #995，尚未正式部署）

Kysely **不是 PostgreSQL RPC 的包裝器**。LOC 共用資料操作應採 Kysely query builder／transaction／schema builder，由 Dialect 配合既有資料庫 Driver；資料庫憑證驗證與 LOC Clerk／Authority Scope 授權是兩個獨立責任。

- PostgreSQL（Supabase、Neon、Cloud SQL 等）：`PostgresDialect`，現行 RLS 和 `silver.manage(type,id)` 權限保持既有機制。
- MySQL／MariaDB：`MysqlDialect`；已加入原生通用 CRUD、Scope 所有權檢查、文章分批寫入。選配簡易 LDAP（`mysql_clear_password`）僅允許 TLS；LDAP SASL 仍取決於可用的 Driver Plugin，**不宣稱已支援**。
- SQL Server：`MssqlDialect`；已加入原生 CRUD、Scope 所有權檢查，以及獨立 NTLM／Microsoft Entra Driver 驗證模式。MSSQL Upsert 以 Kysely MERGE 建立來源資料、逐列引用欄位。
- SQLite：目前保留裝置／常駐 Gateway 模式；尚未將整套 LOC 遠端功能經 Kysely SQLite 驗證。

可選自訂主庫的建置設定：`NEXT_PUBLIC_LOC_PRIMARY_ID=custom-current`、`NEXT_PUBLIC_LOC_SQL_ENGINE=mysql|mssql`、`NEXT_PUBLIC_LOC_SQL_ALIAS=<可信別名>`，對應的連線憑證必須只存於 **Gateway 伺服器端** 的 `LOC_DB_CONNECTIONS_JSON`。現有預設仍是 `supabase-current`，未自行切換主庫。MySQL 與 SQL Server 的目的庫需有 LOC 實際使用的 Registry／Scope 資料結構；Kysely 負責 SQL Dialect，**不會自動把 PostgreSQL JSONB、RLS、Trigger 等資料庫專屬語義變成另一種 SQL**。

目前通用 `query` 與 `managed-write` 已具備非 PostgreSQL 的原生 Kysely 路徑；`anchor`、`analytics`、`public-action`、`managed-action`、Scope DDL 等仍有 PostgreSQL 專有實作，非 PG 路徑暫拒絕這些操作而非繞回 PostgreSQL RPC。此分支尚不能宣告「所有功能都已跨引擎驗收」。須完成 Dialect 逐功能對等實作與實際資料庫／Authority 整合驗證後才合併或啟用。

# LOC 通用 Anchor RPC 契約

## 架構決議（2026-11-03）

**求同存異**：所有一般 Scope（包含 `lo3rwang`、`lrunes`）共用同一套 Anchor 資料讀寫規則。Scope 名稱不決定邏輯分支，`scopeid` 決定資料歸屬，`type` 決定資料類別，`attr jsonb` 承載類別特有的結構。符文首頁、每日符文行事曆、遊戲可維持專用功能；符文內容、一般文章、時間、空間、關鍵詞、媒體及一般統計仍應與其他 Scope 通用。


### 現行 Kysely 主入口（2026-11-04）

前述 `silver.scope_type_attr`、`silver.read_scope_analytics` 與各領域 RPC 為**歷史 SQL 函式契約**。改寫後，網站現行 PostgreSQL 路徑改走 Clerk JWT 驗證的 Kysely Gateway：

- `anchor(scopeid,type,attr)`：直接存取 `{scopeid}_anchor` 的讀取、寫入、局部更新、關鍵詞目錄／建議，以及 Point 連結補寫。
- `analytics(args)`：時間、地點、文章、關鍵詞、共享 Class 與公開搜尋摘要，使用 Kysely 查詢與參數化聚合。
- `managedWrite(payload)` 與 `managedAction(name,args)`：文章批次、搜尋摘要更新、群組與權限設定、空間合併、關鍵詞分享匯入與 Scope 建立／刪除。權限先由現有 Clerk claims 與 `silver.manage(type,id)` 判斷；沿用 LOC Authority，無第二套身分系統。
- `publicAction(name,args)`：公開 Bootstrap、頁面簡介與地點名稱搜尋。

`silver.manage(type,id)` 與 UID 配號函式仍屬資料庫內部的**身分驗證／配號輔助**，不是前端呼叫的 SQL RPC；網站的通用 SQL RPC 執行路由已退役。裝置本機 `local` Scope 使用獨立 SQLite 介面，不屬於遠端 RPC 清理範圍。

Galaxy 文章權限改採八個獨立 boolean 欄位，順序為 `statics`、`culture`、`search`、`trace`、`list`、`keyword`、`extract`、`others`。所有新讀寫都直接使用欄位；舊 `galaxy.able` 只在歷史匯入資料解析或既有本機 SQLite 資料一次性轉換時讀取，不得重新寫入伺服器。**正式資料庫的舊欄位須待新版經部署驗收及相依檢查後另行移除**，不能把程式端切換誤稱為已刪欄位。

**驗證與版本狀態**：本段描述目標分支 `refactor/kysely-clerk-rpc-removal` 的改動，不代表部署、正式合併或資料庫舊欄位已刪除。須以該分支實際回歸測試、PR 合併與 Cloudflare 部署結果分別核對。

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

### Galaxy 權限實體欄位（2026-11-03）

- `silver.{scopeid}_galaxy` 的文章層開關為八個獨立 Boolean 欄位：`statics`、`culture`、`search`、`trace`、`list`、`keyword`、`others`、`extract`。不要再向 PostgreSQL 寫 `galaxy.able` JSONB，亦不要用 `able->>` 過濾。歷史 JSON 名稱 `keywords/game` 對應 `keyword/others`，只在舊檔匯入或裝置本機 SQLite 相容層轉換。
- `silver.lo3rwang.able` 是 **Scope 設定**，不是 Galaxy 文章權限；不得隨文章欄位退役刪除。
- 本次先補齊 `lo3rwang_galaxy`、`lrunes_galaxy` 的八欄並讓既有 RPC 直接查布林欄位；舊客戶端仍存在時保留相容觸發器及原 RLS。新客戶端、Clerk Edge Function、LOC Authority 真正部署且讀寫／隱私檢查通過後，才執行最後的 RLS／觸發器切換與 `DROP COLUMN able`，避免資料公開或連線中斷。
- 用既有 UID 保留文章隱藏狀態；公開 `search`／`list`、搜尋 `extract`、統計與文化視圖不可因遷移而放寬。第三方 Scope 未遷移其儲存結構前，保留其獨立相容入口。


### Kysely Edge 連線壓力（2026-11-04）

LOC 的 Supabase `loc-kysely` Edge Function 使用 pg Pool `max:1`（每個 Edge isolate 各有自己的 pool）。正式環境的 `SUPABASE_DB_URL` 應直接填入 Supabase Dashboard → Connect → **Transaction pooler** 提供的完整連線網址，使用 port `6543`、其原有使用者名稱及密碼；不要從 Region 猜測 pooler 主機名稱，也不要將密碼寫入儲存庫。

在正式 Secrets 切換前，若仍使用 direct/session port `5432`，程式會釋放閒置連線（1 秒），降低連線佔用，但**不能取代 Transaction pooler**。瀏覽器匿名 Kysely 讀取同時最多 3 筆，503 不在同一呼叫內立即重試；Clerk 管理權限檢查與寫入不受這個排隊限制。這是 Code 層限流，沒有新增／變更資料庫表、RPC、權限或索引。


### 取消過時查詢與多 Scope 查詢壓力

Kysely Edge `KyselyQuery.abortSignal(signal)` 現在把呼叫端取消訊號送到實際 `fetch`；在公開讀取佇列中已取消的查詢不再發送 HTTP。獨立逾時仍為 9 秒；讀取管線原有 8 秒逾時可更早中止，取消不視為資料庫故障。Culture 的 Scope 群組、每日密度與不連續 Period 分頁改為上限 2 路並行，保留原輸入順序、時間交集及各窗口游標；Galaxy 跨 Scope 密度同樣限為 2 路。

控制資料庫的 LOC 路由設定仍採既有的 5 秒快取；同一 Edge isolate 內的並發請求共用一筆進行中的路由查詢，正式管理變更會撤銷快取及舊查詢的快取寫回資格。不修改 Supabase 表、Schema、RPC、RLS 或權限。


### 統一內文搜尋（2026-11-04）

一般 Search 僅查 Galaxy `content` 與相同 Scope 唯一實體 Anchor `description`（時間 date/period/era、空間 point/path/trace、關鍵詞 category/class/group/item、媒體 image/video/rune/suno），**不搜尋標題、URL 或媒體專屬標籤欄位**。結果依 Anchor `type` 連到文化 `anchor/period`、痕跡 `place/map`、關鍵詞統計頁，或媒體自身公開 URL；文章繼續連其 Galaxy UID 頁。文章管理的打卡地點工具是獨立管理功能，不視為一般文字搜尋。Anchor 公開讀取仍受 `invisible=false` 和既有 RLS 控制。


### 搜尋的最小資料投影與進階指定（2026-11-04）

Search 的全文比對**僅**作用於 Galaxy 的 `content` 與 Anchor 的 `description`；不搜尋 `title`、`type`、`uid`、`attr`。公開 Anchor 搜尋 SELECT 只投影 `uid,type,description`，另以 `invisible=false` 做公開篩選；`type` 只在進階搜尋選定時，以資料庫精確 `=` 比對。Anchor 沒有日期欄，搜尋不讀 `attr.date`，進階時間範圍僅限定 Galaxy `date`（既有 B-tree）；搜尋頁不再另讀文化時間定錨／時代選單。Anchor 預覽連回各功能頁，媒體跳媒體統計頁，不暴露 Anchor.attr。
