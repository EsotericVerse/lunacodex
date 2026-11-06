### UID 顯示排序與批次排序清理（2026-11-05，第二階段）

- 在資料庫 SQL / Kysely UID 排序修復之後，續清除純 JavaScript `uid.localeCompare` 與 `String(a.uid).localeCompare(String(b.uid))` 排列：文化時間軸、時代／期間、痕跡地點清單、批次補地點、經緯度自動比對、時間長河、首頁 Block、關鍵詞文章分析都不再使用隨機 UID 決定先後。
- 每個清單只沿用其真實優先規則：事件日期、`createtime`、地點距離、地名、`block_order` 或編輯者已選的主要地點。時間或標題相同時保留資料原本順序。沒有時間的歷史 Anchor 不用 `attr.date` 假裝建立時間。
- **UID 作身分與關聯的用途不變**。例如使用者指定的主要 Anchor UID、`new Map([uid,row])` 查找、`WHERE uid` 過濾、以及路線兩端 UID 組合成對稱的關聯鍵，都是身分對應，不是按 UID 排列文章或 Anchor 清單；不可盲目刪除這類引用。
- 關鍵詞讀取器仍以完整的同時間群組確保不漏讀，但不再用 UID 排列同秒／無日期文章；測試改比對集合完整性與時間序列，而非隨機 UID 排列。對應回歸守衛已擴充 JS `localeCompare` 模式，後續不能再用 UID 當 tie-breaker。
- 此第二階段與前一批 SQL 變更是同一個使用者需求；因每個 PR 不超過 20 檔，分為互相獨立的兩組交付，無新增 Schema、索引、RPC 或權限更動。

### UID 只作識別，不參與 SQL 排列（2026-11-05）

- LOC 的八碼 Base62 `uid` 為隨機身分鍵，用於 `WHERE`／`JOIN`／關聯，**不得作 `ORDER BY uid`，也不得放在日期、名稱、Block 順序後當第二排序鍵**。這次未重新指定搜尋、文化、痕跡的主要時間排序政策；已存在的 Galaxy `date`、`createtime` 與 Anchor `createtime` 保留各自語意。
- 已修正 Kysely、可攜 SQL、舊式相容讀取、匯入、關鍵詞、空間管理與搜尋查詢：文章可按既定日期／建立時間；Anchor 需要排列則取 `createtime`、名稱或 `block_order`，同時間的前後順序不作 UID 人為強制。
- 需完整比對歷史匯入的跨頁時間戳，現在以 **時間游標＋分頁末筆同時刻全集** 前進，遇到同時刻筆數超過安全上限即停止，不允許因取消 UID 排序造成重複或漏讀。UID 配號不再為了避免碰撞而掃描／排序整張 Anchor；由安全亂數與既有資料庫主鍵約束保護。
- SQL 修正寫入新 migration `20261105204000_remove_uid_ordering_active_rpcs.sql`，**不覆寫歷史 migration**。以 Supabase 與 Neon 當前 `pg_get_functiondef` 檢查真正有效的函式，覆蓋地點預覽、關鍵詞公開目錄、痕跡關鍵詞統計、網站來源改名、`scope_group` 與地點名稱搜尋。舊 migration 內出現的排序語句為歷史紀錄，無權重新成為最新 RPC 定義。
- `scope_group` 文化／痕跡 Anchor 原本按 UID 用 `OFFSET 500` 重複抓取；改每類一次完整讀取以避免同時間跨頁遺漏，仍保留原有輸出數量上限與權限。其他單次小型列表在同時間排序相同時允許自然順序。
- 回歸防護：`node --test scripts/test-no-uid-ordering.mjs` 對正在運作的 app／Edge／Worker 程式和最新修正 migration 掃描 UID 排序，避免後續改版重新引入；已套用的舊 migration 保持不變。驗收還須分開確認真正生效 SQL 函式和部署版本。

### PostgreSQL Portable Galaxy 陣列欄位一致性（2026-11-05）

- Galaxy 不包含 JSONB 欄位，八個權限旗標均為獨立 Boolean。`target_id` 使用 PostgreSQL `text[]`；`media_link` 使用 `varchar[]`，與正式 Galaxy 相容。
- Portable PostgreSQL 的 Anchor `attr` 才使用 JSONB；MySQL/MSSQL 的陣列欄位各使用引擎支援的資料型別，不得混同為 PostgreSQL Galaxy JSONB。
- PostgreSQL 媒體數量以 `unnest(media_link)` 解析文章關聯；管理寫入不可將 Galaxy `media_link` 序列化為 JSONB。本次只修 Portable Code，不動既有資料庫。

### Kysely Portable：Point 文章關聯批次寫入（2026-11-05）

- `executePortableKyselyAnchor` 的 `type=point / op=link` 原先逐篇 Galaxy 文章執行 Kysely `UPDATE`，上限 10,000 筆可能造成大量往返；現改為先驗證 Point 與文章 UID，依 Point 分組、每 200 篇合成一個 Kysely `WHERE uid IN (...)` 批次更新。
- 支援原有 `place_id`／`missing_location` 模式、保留只更新原本空白欄位的保護條件，並核對實際更新筆數；不符時傳回 409，交由既有 Gateway Transaction 回滾。
- 不新增表／欄／Index／Trigger／RPC、不重建文章 UID 清單；UID 僅作當次寫入參數。這是功能性 Kysely 性能改善，不涉及公開 Search 或 Auth／Authority 變更。
- 已核對 405 筆同 Point 文章由 405 次 UPDATE 降到 3 次 UPDATE 的模擬測試，以及筆數不符的衝突拒絕；真實 MySQL／MSSQL／PostgreSQL 整合測試仍須另行驗證。

### Kysely Portable 分析檔修復（2026-11-05）

- 檢查 `main` 發現 `kysely-analytics.mjs` 在 MySQL `JSON_TABLE(... PATH '$')` 字串內誤插入完整第二份 Portable Analytics executor，導致 Kysely SQL 模板與檔案結構毀損。
- 清除錯誤拼接區段，保留單一 Portable executor 與原來的媒體關聯去重計數邏輯；不變更任何 UI、Auth、LOC Authority、SQL Schema、RPC、八個 Galaxy Boolean 或四個 Scope Boolean。
- 回歸測試包含完整模組解析、SQL 展開片段、函式唯一性、三種方言模板及查詢篩選條件；模擬測試不等同真實 MySQL／MSSQL／PostgreSQL 整合測試。
- 後續 Portable 關鍵詞分析不可依賴已淘汰的逐文章 `uidlists` / `hits`：現行 Anchor 關鍵詞實體主要保存結構與彙總計數；期間、日別、地點交叉分析需要另行核對實際可用資訊，不能把全期總量冒充細分結果。

### Portable Overview 媒體數量等價修正（2026-11-05）

- Portable Overview 現在透過 Kysely QueryBuilder 篩選 statics=true、有內容、日期區間內的 Galaxy 文章，再用各 Dialect 的 JSON 陣列展開運算計算 media_link 關聯的 **不同媒體 UID 數**；再與 Anchor 可見的 image/video/rune/suno 類型交集。原本只計算整張 Anchor 媒體存量，並不等於連結統計，已更正。
- MySQL 8 的 JSON_TABLE、SQL Server 的 OPENJSON、可攜 PostgreSQL 原生 SQL 陣列的 UNNEST 是各資料庫原生陣列展開函式；Kysely 負責共同 query builder 與編譯，只有這段 SQL 表達式依引擎分流。MySQL/MariaDB 與 SQL Server 所需的 JSON 函式支援／相容層級須由實際環境驗證；未知引擎直接拒絕而不回傳誤導數值。
- 不抓取文章全文到應用程式、不逐篇發 SQL、不排序 UID、不新建 RPC、表、Trigger、Index，也不改動 UI、Clerk、Authority、Galaxy 八 Boolean、Scope 四 Boolean 或 Anchor.attr。
- 已新增 portable SQL 路徑的針對性測試；正式跨引擎查詢及部署成功尚待獨立證據，不能把測試替身視為資料庫整合測試。

### Portable RPC → Kysely 執行現況（2026-11-05）

- **已改寫**：通用 Galaxy/Anchor CRUD、管理寫入、公開查詢與 Bootstrap、一般每日／來源統計、總覽、最早日期、痕跡地點與期間密度、部分關鍵詞 Class 目錄，透過可信 Gateway 的 Kysely Dialect 執行；舊 RPC 名稱仍可能出現在相容客戶端與歷史 Migration，不能視為實際使用證據。
- **本次修正**：跨引擎 LOC 總覽的最早日期不再被顯示時間區間誤縮小；portable daily 的 includeUndated 不再因分組過濾掉 NULL 日期。兩者沿用 Boolean 欄位，無新表、索引、RPC 或 Schema 變更。
- **尚未完成的等價功能**：portable keyword_summary、trace_keywords 的複合關聯及授權等價；跨 SQL 引擎真實測試仍待驗證。
- **不得直接刪除**：Clerk／LOC Authority 授權所依賴的資料庫輔助函式、仍被 RLS／Trigger／既有相容端呼叫的 RPC。須逐一驗證服務端呼叫與 SQL dependency，才能安排清除。Kysely 的 query builder、transaction、Dialect 不是權限系統，無法替代 DB 層級的授權語義。
- **驗收邊界**：這次新增 portable 統計針對性回歸測試；跨 MySQL / MSSQL 真實連線整合、公開權限等價與已部署行為尚未證明，不能把程式碼編譯或 PR Merge 當成 portable 全功能完成。

### 官方 Kysely 版本與 Agent 文件（2026-11-04）

- 官方目前最新穩定版本為 **Kysely 0.29.8**（2026-11-01）；PR #995 已同步 `package.json`、`package-lock.json`、所有 Deno `npm:kysely@...` 版本引用。0.29.7 修正 controlled transaction 的競態／連線與 MSSQL JSON；0.29.8 修正 PostgreSQL rollback／aborted-commit。
- Kysely 官方推薦 AI 文件：[llms.txt](https://kysely.dev/llms.txt)、[llms-full.txt](https://kysely.dev/llms-full.txt)；專案本機使用 `.github/skills/kysely-portable-loc/SKILL.md` 指向官方文件及版本，不依賴第三方過時 Skill。
- 官方有 `Dialect`、`SchemaBuilder`、`Migrator`、`transaction`、`withPlugin`、`withSchema`，可以實作無 RPC 的 CRUD、Schema 與資料異動；但**沒有可取代 Clerk 驗證／LOC Authority 的內建登入系統**。官方的 `$pickTables`／`$omitTables` 只縮小 TypeScript 型別視野，不能當執行期權限檢查。
- 使用 Kysely **取代可替換的 SQL RPC** 是正確的可攜性方向；PostgreSQL RLS／Policy 與其他引擎的授權、JSON 資料型別和 DDL 差異，仍需要可信 Gateway 依既有語義處理，才能真的達到「連線與最小必要資料表」即可運作。
- 本次是原分支 PR 變更，尚未通過完整 `npm run check:syntax`、真實 Dialect／Clerk 整合與部署驗收；不得誤稱正式資料庫已同步或 RPC 已刪完。

### 身分驗證與 SQL 可攜性修正（2026-11-04）

- LOC 網站身份固定為 **Clerk + LOC Authority**，不再允許 Supabase Auth JWT 取代 Clerk 登入。PostgreSQL 以既有 `api.manage()` 保持權限判定；非 PostgreSQL 透過 Kysely 讀取目標庫既有 `api.manage` Registry 與 `silver.loc.blacklist`，比對經驗證的 Clerk email/subject，拒絕已封鎖帳號與未授權 Scope。
- 資料庫連線使用該資料庫自己的連線 Driver／認證（MySQL 可選 LDAP simple + TLS，SQL Server 可選 NTLM／Entra）；**資料庫驗證不等於 LOC 使用者登入**。MySQL Driver 更新至已修補的 `mysql2@3.22.0`。
- 原生 Kysely CRUD／UPSERT／transaction 優先使用 Dialect，不因 MySQL／SQL Server 缺少 PostgreSQL RLS 而一概拒絕；但對外公開文章的 `search/list/extract` 隱藏規則、Anchor 複合 JSON 查詢／關聯寫入、文化／統計與 Scope DDL 尚待逐引擎等價驗收。未證明安全等價前仍拒絕這些操作，不可繞過授權。
- 歷史的獨立 `neon-primary.mjs`／Neon Data API 備援仍含 Neon Auth token 流程，**不在目前預設 Clerk 登入路徑中**；若要求 Neon 備援完全不依賴 Neon Auth，必須先配置獨立可信任 Kysely Gateway 及其資料庫權限，再切換該備援傳輸。當前不能宣稱備援已完全解耦。
- 回歸檢查：`scripts/test-kysely-clerk-only-auth.mjs`、`scripts/test-kysely-portable-access.mjs`；正式 `npm run check:syntax` 與完整 Dialect/Clerk 整合測試仍需執行，不得以獨立模擬取代。


### Kysely 跨 SQL 引擎可攜性（PR #995，尚未正式部署）

Kysely **不是 PostgreSQL RPC 的包裝器**。LOC 共用資料操作應採 Kysely query builder／transaction／schema builder，由 Dialect 配合既有資料庫 Driver；資料庫憑證驗證與 LOC Clerk／Authority Scope 授權是兩個獨立責任。

- PostgreSQL（Supabase、Neon、Cloud SQL 等）：`PostgresDialect`，現行 RLS 和 `api.manage(type,id)` 權限保持既有機制。
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
- `managedWrite(payload)` 與 `managedAction(name,args)`：文章批次、搜尋摘要更新、群組與權限設定、空間合併、關鍵詞分享匯入與 Scope 建立／刪除。權限先由現有 Clerk claims 與 `api.manage(type,id)` 判斷；沿用 LOC Authority，無第二套身分系統。
- `publicAction(name,args)`：公開 Bootstrap、頁面簡介與地點名稱搜尋。

`api.manage(type,id)` 與 UID 配號函式仍屬資料庫內部的**身分驗證／配號輔助**，不是前端呼叫的 SQL RPC；網站的通用 SQL RPC 執行路由已退役。裝置本機 `local` Scope 使用獨立 SQLite 介面，不屬於遠端 RPC 清理範圍。

Galaxy 文章權限改採八個獨立 boolean 欄位，順序為 `statics`、`culture`、`search`、`trace`、`list`、`keyword`、`extract`、`others`。所有新讀寫都直接使用欄位；舊 `galaxy.able` 只在歷史匯入資料解析或既有本機 SQLite 資料一次性轉換時讀取，不得重新寫入伺服器。**正式資料庫的舊欄位須待新版經部署驗收及相依檢查後另行移除**，不能把程式端切換誤稱為已刪欄位。

**驗證與版本狀態**：本段描述目標分支 `refactor/kysely-clerk-rpc-removal` 的改動，不代表部署、正式合併或資料庫舊欄位已刪除。須以該分支實際回歸測試、PR 合併與 Cloudflare 部署結果分別核對。

### 主入口

```sql
silver.scope_type_attr(p_scope_id text, p_type text, p_attr jsonb)
```

`p_scope_id` 以 `api.manage.anchor_table` 查找 `silver.{scopeid}_{anchor_table}`，驗證該 Scope 的權限。`p_type` 使用統一類型集合：
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
- Scope 主設定的功能開關已統一為 `silver.lo3rwang` 與 `silver.lrunes` 的四個獨立 Boolean 欄位：`trace`、`search`、`culture`、`statics`。舊 `silver.lo3rwang.able` 已退役，禁止在 Code／RPC 繼續使用；如備援庫仍有該舊欄，不代表仍須讀取。
- 本次先補齊 `lo3rwang_galaxy`、`lrunes_galaxy` 的八欄並讓既有 RPC 直接查布林欄位；舊客戶端仍存在時保留相容觸發器及原 RLS。新客戶端、Clerk Edge Function、LOC Authority 真正部署且讀寫／隱私檢查通過後，才執行最後的 RLS／觸發器切換與 `DROP COLUMN able`，避免資料公開或連線中斷。
- 用既有 UID 保留文章隱藏狀態；公開 `search`／`list`、搜尋 `extract`、統計與文化視圖不可因遷移而放寬。第三方 Scope 未遷移其儲存結構前，保留其獨立相容入口。



### 關鍵詞 Item 判斷詞連動規則（2026-11-04）

- 規則與普通判斷詞一起存在既有 Item 的 `lists`，每行一筆，不新增資料表／索引／欄位；判斷詞在文章**內文**比對，不改寫原始文章。
- `來源AND目標Item名稱`：命中來源時保留來源 Item 的正常命中，並給指定目標 Item **額外一筆**連動命中（例如 `家園AND音樂`）；已有的來源詞不因此重複計數。
- `來源TO目標Item名稱`：來源指定導向目標 Item，不計入規則所在 Item 的來源規則命中（例如 `水土TO地`）。
- `來源NOR排除詞`：在規則所在 Item 的所有普通判斷詞及其連動規則判斷之前，排除完整相接的 `來源+排除詞` 片段。例如 `家園NOR旅館` 會使「家園旅館」不計入家園 Item，但文章內其他獨立的「家園」／「故鄉」仍正常計算；不影響其他 Item。
- 目標必須能在目前 Class 的 Item 名稱中解析；無法解析者維持舊有 `unsupportedRules` 行為，不偷偷建立新 Item。新增規則或修改判斷詞後，需重新分析該 Class 才會更新既有命中統計。

### 文化時間定錨編輯操作（2026-11-04）

- 時間定錨編輯模式已由共用編輯快捷操作列提供「儲存／取消」，故移除時間表單最下方重複的兩顆按鍵；保留編輯既有定錨時的「刪除」操作。
- 表單提交函式及編輯操作列儲存仍共用既有驗證、儲存與錯誤回報流程。
- 時間編輯的時間長河左側以「時代」為頂層（可顯示空時代），按「＋」才展開該時代直接關聯的「期間」；期間下不再展開或重複列出定錨點。原先的平面時代／期間／定錨點總覽已改為此分層模型，且不影響公開文化時間長河既有定錨點顯示。\n- 時間管理圖表上提供「更新時間長河」手動重新讀取；「自動整理」完成後刷新現有圖表資料，但時代連結仍為草稿，需按共用儲存鍵確認；正式儲存、新增週年、刪除及大量顯示設定完成後自動刷新時間長河資料。原本的「重置」維持只重置圖表視野，不混淆成重新載入資料。

### 關鍵詞重新分析的 Galaxy DATE 游標（2026-11-04）

- 關鍵詞重新分析以 Galaxy `date` 既有 B-tree 遞增分頁，跨同日頁尾先讀齊該日，再依 `createtime` 與 UID 在記憶體中排序；不能改成 `ORDER BY uid` 或為此新增索引。
- PostgreSQL 的 DATE 經不同 SQL Driver 可能輸出 `YYYY-MM-DD`、UTC 午夜 ISO，或台北午夜轉換為前一天 `16:00Z`。讀取器先恢復 DATE 的原始日曆日，再核對每筆文章 `createtime` 的台北日期。日期錯誤或分頁不完整時不寫入統計結果。
- SQL Gateway 若仍傳入不合法 DATE 或非遞增游標，錯誤會附上前次日期、本頁首末日期與原始末日格式，以便直接定位；不記錄文章內容、身分或私密憑證。

### Kysely Edge 連線壓力（2026-11-04）

LOC 的 Supabase `loc-kysely` Edge Function 使用 pg Pool `max:1`（每個 Edge isolate 各有自己的 pool）。正式環境的 `SUPABASE_DB_URL` 應直接填入 Supabase Dashboard → Connect → **Transaction pooler** 提供的完整連線網址，使用 port `6543`、其原有使用者名稱及密碼；不要從 Region 猜測 pooler 主機名稱，也不要將密碼寫入儲存庫。

在正式 Secrets 切換前，若仍使用 direct/session port `5432`，程式會釋放閒置連線（1 秒），降低連線佔用，但**不能取代 Transaction pooler**。瀏覽器匿名 Kysely 讀取同時最多 3 筆，503 不在同一呼叫內立即重試；Clerk 管理權限檢查與寫入不受這個排隊限制。這是 Code 層限流，沒有新增／變更資料庫表、RPC、權限或索引。


### 取消過時查詢與多 Scope 查詢壓力

Kysely Edge `KyselyQuery.abortSignal(signal)` 現在把呼叫端取消訊號送到實際 `fetch`；在公開讀取佇列中已取消的查詢不再發送 HTTP。獨立逾時仍為 9 秒；讀取管線原有 8 秒逾時可更早中止，取消不視為資料庫故障。Culture 的 Scope 群組、每日密度與不連續 Period 分頁改為上限 2 路並行，保留原輸入順序、時間交集及各窗口游標；Galaxy 跨 Scope 密度同樣限為 2 路。

控制資料庫的 LOC 路由設定仍採既有的 5 秒快取；同一 Edge isolate 內的並發請求共用一筆進行中的路由查詢，正式管理變更會撤銷快取及舊查詢的快取寫回資格。不修改 Supabase 表、Schema、RPC、RLS 或權限。


### Anchor 建立時間參照（2026-11-05）

- `{scopeid}_anchor` 保留既有八碼 Base62 `uid` 主鍵，另外新增實體 `createtime timestamptz`（非唯一、可為 NULL）；**不**以 timestamp 作主鍵，也**不新增索引、Trigger、RPC**。兩表 `lo3rwang_anchor` 和 `lrunes_anchor` 均已套用相同欄位。
- `createtime` 是 Anchor 的建立／來源文章精確時間，用於媒體重建、同一時間比對及日後需要的 Anchor 排列；文化 `type=date` 的 `attr.date` 只代表事件日期，兩者絕不互換、也不由 `attr.date` 推導建立時間。
- 從文章匯入／建立的 Media、Date 與 Point Anchor，建立時使用來源 Galaxy `createtime`。沒有文章時間的全新手動 Anchor 使用資料庫的 `CURRENT_TIMESTAMP`。相同文章的多張圖片可同時刻；不可單靠 `createtime` 判定唯一媒體。
- 歷史回填僅對有 `Galaxy.media_link` 且能確認**單一來源文章時間**的媒體 UID 寫入。被不同時間文章共用或缺來源證據的 Anchor 留 `NULL`；不捏造時間、不覆蓋 UID、不合併或刪除資料。
- 媒體匯入既有 UID／URL 比對保持不變；沒有 URL 的文章媒體採「文章 UID + media type + title + description + `createtime` + location」比對，並由物理 Anchor.createtime 提供時間，不能再錯用 `attr.date`。
- Portable SQL 的新建 Scope Schema 包含同名欄位，連線前會驗證它。Supabase 與 Neon 的 `lo3rwang_anchor`／`lrunes_anchor` 都已套用相同的新增欄位及保守回填；未升級的外部 PostgreSQL／MySQL／SQL Server 資料庫仍需採用其各自非破壞性加欄遷移後才可使用新版。
- 搜尋主功能仍然只搜尋 Galaxy `content`；本次保留原本的主要排序政策，但依後續需求移除所有 UID 次要排序。

### 統一內文搜尋（2026-11-04）

一般 Search **僅搜尋 Galaxy `content`**，不搜尋 Anchor `description`、文章標題、URL 或 UID。搜尋結果僅顯示文章；定錨內容由文章的既有時間／空間／關鍵詞／媒體關聯連入，禁止讓 Anchor 反過來主導文章搜尋。文章管理的打卡地點是獨立管理工具，不是公開文字搜尋；原有文化、痕跡、統計 Anchor 讀取功能不受影響。


### 搜尋的最小資料投影與進階指定（2026-11-04）

Search 只對 Galaxy `content` 執行模糊比對；進階內容類型只保留「文章／歌詞／文字作品」。搜尋結果可讀 Galaxy 的標題與 `date` 作展示，但不拿標題或 Anchor 執行全文搜尋。進階日期範圍用 Galaxy `date`；搜尋排序政策沿用現行行為，本次先不修改。


### Max MultiPara 與 MCP 內容搜尋（2026-11-04）

`MAX_MULTIPARA=10` 是 `mapBounded` 和本地匿名 Gateway 讀取佇列的硬上限；要求 100 路時也最多啟動 10 路。公開查詢仍預設 3 路、文化群組 2 路。不同瀏覽器、MCP 與不同 Edge Function isolate **不共用** JavaScript 變數，因此這不是全域 10 條 PostgreSQL 連線限制。正式 DB 連線容量仍應由 Transaction Pooler 與伺服器端流控管理。

`loc-kysely` 的 MCP 搜尋改為僅匹配 Galaxy `content`，排序採既有 Galaxy `date`。MCP 依 UID 讀取完整文章不變。Supabase Data API 的 Max Rows 管的是單次回傳的資料列數，並非總資料筆數、SQL 查詢累計次數或連線上限。大量 content 的 payload 成本另計。


### 時間定錨整理與虛擬紀念日批次工具（2026-11-04）

- 文化管理的「自動整理」只讀取實際已存在的 `date`、`period`、`era`，不推算任何週年。期間以既有起訖 Date UID 表達區間，區間內的 Date 只做即時計算與列示，不新增其他資料或改寫 Schema；時代從已選期間的實際日期窗口找出完全落在窗口內的既有期間，加入同一份編輯草稿，使用者仍須按「儲存修改」才寫回。
- 「建議紀念日」不是持久化 `aniversary` 類型：名稱、原始日期、年份範圍、週年範圍只用於編輯器的單次批次計畫。使用者按「建立週年時間」並確認後，僅補建缺少日期的正式 `date` Anchor；同日期已有任何 Date 就跳過，不覆寫，不變更 Galaxy、匯入器、統計或原有期間與時代連線。閏日僅在合法的 2 月 29 日建立。
- 兩種操作都在明確點擊後才分頁讀取全量時間紀錄；一般文章清單與 Culture 瀏覽不新增背景 SQL 或 Scope 管理權限預讀。使用既有 Clerk／Scope 寫入路徑、UID8 Base62 配號，沒有新表、索引或 RPC。
- 純邏輯回歸：`node --test scripts/test-culture-anchor-bulk.mjs`；此處不宣稱連接器已執行此測試。


### 搜尋 QoS 與功能邊界（2026-11-04）

- 唯一允許使用者主動對 Galaxy `content` 送出模糊比對的入口是**搜尋主功能**；Anchor `description` 不接受全文搜尋。Culture 只以 `date` 與時間定錨、Trace 以 `place_id` 與空間定錨、Statistics 以結構化欄位及既有分析結果取得文章，不額外搜尋全文。搜尋主頁的 Galaxy 全文搜尋保留。
- 搜尋 UI 於新文字搜尋之間強制 **3 秒冷卻**（瀏覽、分頁載入、依 UID 展開全文不適用）；伺服器只針對 Galaxy `content` 的 `ILIKE/LIKE` SELECT 作搜尋 QoS，其他管理寫入、文章列表、日期與地點查詢不受影響。
- Gateway：同一個識別來源 **每分鐘最多 24 次文字搜尋 SQL 請求**（一次搜尋動作可能涉及多個 Scope／Provider）；新搜尋動作的最少 3 秒間隔由 UI 實施。伺服器不對同一動作的各個 SQL 子查詢額外套用 3 秒間隔，以免誤擋合法的跨 Scope 搜尋。超限後暫時封鎖 **120 秒**、回傳 HTTP 429 與 `Retry-After`；搜尋用 PostgreSQL 交易設定 `statement_timeout=8000ms`，SQL 超時回傳 `SEARCH_TIMEOUT`，不執行自動重試。
- 限流目前使用 Edge Function **單個 warm isolate 的有上限記憶體**，不查詢或寫入額外資料表、不新增 RPC、Trigger、Index、不變更既定 QoS 16。**這不是跨所有 Edge instances 的全球共享黑名單**；跨實例、跨區域的強制防護將來須由部署層的共享限流能力承擔，不能把本版本宣稱成分散式全域封鎖。
- 已設有搜尋使用者端 25 秒 abort 與 Kysely HTTP 9 秒 deadline；SQL 8 秒設定是另外在資料庫端阻止長時間掃描。僅對 PostgreSQL 實際施加 `SET LOCAL statement_timeout`；其他 SQL 引擎不應宣稱享有相同的伺服器端保證。
- 驗收：`node --test scripts/test-search-qos.mjs`，另須核對部署中的 HTTP 429、`Retry-After` 和 SQL timeout，以及搜尋主功能正常找到包含指定詞的文章。測試與部署結果各自記錄，不得以本文件代替驗證。


### 文化公開頁 Site 清單補齊（2026-11-06）

- 文化公開頁使用既有 `FeaturePage` 執行一次 `hero_blocks(scopeId, culture)`；**不可在 `CulturePublicReader` 再查、再畫第二個 Hero**。
- 來源分類維持既有 `ArticleTag`，不可誤改為 `ArticleClass`；系統分類讀 `loc.DefaultArticleClass`。
- 兩條河道讀取維持 `culture_anchors`、`culture_density`：時間分布與密度分布不查 Galaxy UID；點擊來源分類或 (+) 只在記憶體排列。
- 每一個已展開的 Site 顯示各自的「顯示相關文章列表」按鍵。只有按此鍵才呼叫現有 `selectCultureArticleListPage`（已使用 portable Kysely `culture_list`），按指定 Site 和一年日期窗口取得最多 100 筆，先展示 20 筆。下一組 20 筆從記憶體顯示，超過該 100 筆才查下一頁；換 Site 清理原列表。
- `list=false` 須在後端遮蔽 UID、標題與日期，前端僅顯示「本文已隱藏」。全文按 UID 展開仍是獨立使用者動作。此次不修改任何 Table/Column、RLS、編輯寫入或搜尋 QoS。

## 2026-11-06｜文化首頁第一條河道（時代階層）

- 初始左側只顯示時代（era）清單，每一項有「＋」展開；**不得額外列出未展開的期間或「時間定錨點」分類**。
- 展開某個時代後，才在該時代下列出其引用的期間（period）；同一期間可隸屬多個時代，分組 ID 需加入時代 UID，避免碰撞。
- 日期定錨點（date）顯示在所屬時代的河道上；依 era 引用的 period 真正日期區間或 era 自身日期判斷，不以包含空隙的最大外包範圍錯誤歸屬。沒有對應 era 的定錨點不另外建立左側河道。
- 首頁預設視窗為台北時區的今天往前一個日曆年；保留既有河道縮放與展開後不重置視野的行為。
- 專項模型測試：`scripts/test-culture-era-first-river.mjs`。

## 2026-11-06｜文化首頁第二條河道的篩選控制

- 第二條「文章密度」河道保留獨立的時期選擇（預設近一年／各 era／自訂起訖日），不改動第一條時間定錨河道的預設近一年與左側 era 階層。
- 分類顯示允許「文章來源」或「關鍵詞」。關鍵詞科目從既有 `shared_classes` 查詢公開項目，選擇後只讀 `keyword_catalog` 的群組名稱，並依現有 Anchor group/item `attr.total` 的總量比例，將既有 `culture_density` 每日密度做**比例展示**（若沒有統計總量才退回等份）；不使用舊版 `keyword_summary` 逐篇 UID 清單演算法，圖示不代表實際關鍵詞命中筆數。沒有公開科目時顯示明確提示，不額外擴大 SQL 權限。
- 變更時期或分類會清除舊文章列表與展開狀態；文章列表只在來源模式明確點擊才載入。不重建 RPC 或 SQL Schema。
- 回歸測試：`scripts/test-culture-second-river-controls.mjs`。

## 2026-11-06｜空間名稱清單定位與時間編輯河道一致性

- 「空間定錨 → 地點管理 → 名稱整理」搜尋結果為正常文件流內、最大高度受限的捲動清單；不再套用路線欄位的 `position:absolute` 自動完成選單，避免覆蓋下方批次整理與浮空六鍵。
- 「時間定錨 → 編輯」第一條河道與文化公開第一河道採同一層級：初始僅時代（era）與展開（＋），時間定錨點顯示於 era 河道，展開後才加入 period 子河道；不另列未歸屬定錨點／定錨點子列表。
- 編輯頁預設台北時間近一個日曆年，保留日期或期間項目點選後進入現有編輯流程，沒有變更資料庫／MCP／RPC。
- 回歸：`scripts/test-spatial-name-and-editor-era-river.mjs`。

## 2026-11-06｜文化第二條河道：小分類點選才讀文章

- 大分類左側（＋）只在已取得的每日密度中展開小分類，**不觸發 Galaxy 文章列表查詢**，也不在圖表下方列出全部小分類文章按鈕。
- 使用者點擊一個來源小分類，才呼叫既有有界 `selectCultureArticleListPage`。下方僅保留**一份**該小分類文章清單；切換另一個小分類時，先清掉原有文章、全文、游標與分頁，再以新結果替換。
- 異步請求採 sequence 防止前一個小分類的晚到回應覆寫新結果。日期區間、來源／關鍵詞顯示切換同樣清掉舊列表。
- 分頁追加只限明確點選「點擊繼續顯示」，不預先載入其他小分類。關鍵詞比例河道不把群組名稱冒充 Galaxy.site 進行錯誤文章查詢。
- 回歸測試 `scripts/test-culture-lazy-subcategory-articles.mjs`。

## 2026-11-06｜痕跡首頁空間資料按需載入

- 痕跡首頁只讀 Anchor `type in ('path','trace')` 以取得路線索引；選中路線後才以其成員 UID 查 `type='point'`，不預先讀取整個 `*_anchor`，也不查 Galaxy 文章。
- 沒有已存路線時顯示空地圖與提示，不再觸發 `readAllTraceAnchors` 的全量掃描；使用者設定 `display=anchor` 不得造成首頁載入全部 point。
- 各 Scope 優先顯示單一已儲存 path（保留 4 碼舊 UID 與正式 Base62 8 碼 UID 相容）；LOC 彙整頁優先顯示實際單一路線，既有跨路線聯集為**明確選擇**才讀取，而非預設。
- 點選地圖上的單一地點、再進入文章頁籤才讀有界 Galaxy 文章列表；明確 `?place=` 深連結可例外進入該地點文章，無關一般首頁載入。
- 只變更痕跡首頁的資料讀取時機與路線選擇，不變更資料表、權限、RPC、MCP 或全量管理工具；更新 `scripts/test-traces-feature.mjs` 與 `scripts/test-trace-loc-route-options.mjs` 回歸測試。

## 2026-11-06｜LOC 痕跡圖：動態共點、全圖 50 個

- 僅 LOC 彙整頁：**不畫 path/trace 路線、痕跡線段**；先以 Scope 的 `trace=true` 篩掉未開放成員，再查其公開 path/trace 索引，從每位成員引用的 point UID 去重、各取前 50 個候選，再有界讀取 point；未被 path/trace 引用的 point 不參與。
- 客戶端依 GPS 距離 75 公尺內動態合併近似位置，同一共點保留原始各成員紀錄，圖釘標籤可同時列出 `lo3rwang:板橋車站 / lrunes:板橋車站` 等獨立來源，不回寫或合併 UID。
- 多個 Scope 每人最多 50 個候選，**先全部完成近似座標比對，只保留至少兩個不同 Scope 的共點交集，再依共點成員數優先排序，最後最多顯示 50 個位置**；共點少於 50 就照實顯示，不用單人獨有地點補足。不可在每個 Scope 處理完就截取全域 50，否則將遺漏後續成員的共點；無有效座標的點不顯示。地圖仍可點選記錄，但預設不查文章。
- 其他 Scope 的 path/trace 地圖保留原行為；無 Schema、SQL、RPC 或 MCP 變動。回歸測試：`scripts/test-loc-trace-top50-points.mjs`。

## 2026-11-06｜移除已退役的統計多媒體計數

- Statistics 來源與日期 `overview` 只查有權顯示的 Galaxy 文章密度、最早日期及來源分類；移除 native `linkedMediaCount`（`media_link` 對 Anchor）與 portable `Anchor.type in image/video/rune/suno` 全量計數，也不再回傳 `media_count`。其他媒體展示、匯入及管理功能不受影響。
- Supabase Query Performance 曾有頂層 `postgres` 診斷查詢（`WITH m AS ... LEFT JOIN galaxy ON a.uid = any(g.media_link)`，包含 `different_times` 和 `orphan`），單次約 62.3 秒；不是網站 overview 所產生的同一段 SQL。查詢只呼叫一次，呼叫者來源未能由 pg_stat_statements 確認。
- 此診斷的 `LEFT JOIN + count(*)` 無法辨識無文章連結的 Anchor（無匹配也至少一列）；診斷不應加入常態統計載入。過去用於補寫 `anchor.createtime` 的 Migration 保留歷史紀錄，不重跑或改寫。
- 測試：`scripts/test-kysely-portable-search-summary.mjs` 改驗證不存在多媒體計數 Helper、`overview` 不從 Anchor 或 `media_link` 取數。
