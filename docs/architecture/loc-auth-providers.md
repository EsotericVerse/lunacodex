## 2026-11-06｜管理權限 30 秒快照的 Session Key 修正

- 網站 Clerk 身分的管理權限快照改用**已驗證**的 `issuer + sub + sid + email` 作快取 Key，JWT 在同一 Session 內更新 `exp`／`jti` 不會重讀 `manage`；仍每次由 Gateway 驗 JWT，並且快照最多 30 秒、不得超過目前 Token 的有效期限。這裡**沒有**將管理權限延長到兩小時，權限撤銷最多仍受 30 秒短期快取限制。
- MCP OAuth Token 沒有 Clerk 互動式 `sid` 時保留原本 token-bound 權限快取 Key，不能混入網站 Session Key。此修正只更新 `app/loc/providers/loc-authorization.mjs` 的快取辨識，不更動 Authority Worker、Kysely 授權分層或六鍵 UI。

## 2026-11-06｜Kysely Session 與 MCP Authority 去重

- Website Kysely 每次受保護請求仍呼叫 `jwtVerify`，不快取 JWT、不略過簽章或過期檢查；同一 Clerk `iss + sub + sid` 的 Authority 已驗證 Email 在同一 Edge isolate 中最多重用 **2 小時**。同一 Session JWT 旋轉可重用，換 Session 必須再驗證；並行相同 Session 首次驗證合併一個請求，失敗立刻失效。
- MCP 保留原本 JWT 驗簽、`token SHA-256 + Scope + action` 獨立授權與 **30 秒快取上限**，增加並行 single-flight：同時抵達的相同授權要求只問 Authority 一次，失敗立刻清除；read、manage、write 不共用。
- 未修改 OAuth Token、Authority Worker、資料庫 Schema／RLS 或 `api.manage`；這些程序記憶體快取不跨 isolate，且不等於撤銷管理權限。管理權限仍另行短期檢查。這個 PR 不代表完整消除所有獨立的 Authority HTTP 請求，需以正式執行指標驗收。

## 2026-11-06｜網站 Clerk Session 身分驗證重用（不改 MCP）

- 網站同一個已驗證 `Clerk sub + sid` 在兩小時的編輯 Session 期間，可重用 LOC Authority 確認的身分 Email；前端在 Clerk SDK 有正式 Session ID 時依 `sid` 辨識，不以短期輪替的 JWT 字串誤當新登入。沒有 SDK Session ID 時保守維持 exact-token 對比。
- 本 PR 僅修改網站瀏覽器端的 Clerk Session 身分結果重用。Kysely 每個受保護請求仍獨立驗證 JWT，Gateway → Authority 的驗證仍維持現況；不修改 MCP、Authority Worker、SQL 或 Kysely。前端不儲存 JWT、不以身分快取取代後端管理權限核對；此 PR 不宣稱已降低 Gateway → Authority 的請求量。
- `api.manage` 的 Admin/Group/Scope 與黑名單仍走獨立授權（短期 30 秒快照、各次 SQL/RLS 持續執行）；編輯 Session 過期仍拒絕寫入。本修正不是將管理權限或撤銷狀態無條件快取兩小時。
- 原本 `silver.lo3rwang.count` 測得 189 次 `api.manage()` 是資料庫內部函式觸發次數，不可當作 Authority HTTP 次數，診斷計數已於 11/05 移除；本修正不重啟 SQL 熱路徑計數器。

## 2026-11-05 編輯模式／首頁儲存與搜尋回歸檢討

- **原因之一：暫存流程並非暫存。** 固定六鍵的 Save 在部分功能頁被標成「已暫存」，實際卻執行完整 SQL 寫入；首頁寫入成功後還會呼叫 `editDock.complete()` 強制導頁，重新掛載管理元件。現改回單一路徑「儲存」，成功後維持編輯頁。
- **原因之二：空儲存與重複讀取。** 編輯 Dock 在沒有待修改欄位時仍可能呼叫目前表單的 `save()`，而 Block Draft 每次寫入後同時重新驗證兩組 SWR 資源。現在僅對 Dirty 表單正式寫入；成功後以已寫入的列直接更新目前的 SWR 顯示，不額外執行兩次 SELECT。功能頁單一 Block 亦沿用固定 Save。
- **原因之三：舊版快取鍵殘留。** Culture 編輯成功後仍無效化 `v2/v6`，但 UI 使用 `v4/v8`，導致顯示不同步；已改為對應資源前綴無效化。時間定錨表單不再因按 Enter 隱性儲存。
- **原因之四：搜尋故意壓掉日期。** 搜尋列表原先只在 Identity 詳細頁傳遞日期；現在 Galaxy 查詢同時回傳 `date`（本機資料維持 `createtime`），每張搜尋結果顯示日期。相同搜尋頁只更新 URL Query，不透過 Next Router 重新載入整個頁面，真正搜尋仍使用既有 `Galaxy.content` 與 `Anchor.description`。
- **其他多餘儲存入口。** 分類與路線編輯頁在固定 Dock 啟用時隱藏各自的 Save/Cancel；切換提示不再有「儲存並切換」第二寫入路徑。必要的新增／批次寫入工具維持其明確用途，不當成一般 Save。
- **權限與效能邊界。** Clerk OAuth 繼續驗證身分；LOC Authority 判斷 Scope；Kysely 寫入仍由後端授權。已驗證且未過期的 Clerk OAuth JWT，在同一受信任 SQL Gateway isolate 中，最多重用 30 秒 LOC 權限快照；不簽發新憑證、不使用 Cron、無背景查詢，下一個實際請求才按需刷新。任何請求仍需通過 JWT 驗簽及 exp，快照亦不得超過 exp；更改角色／黑名單時，其他執行個體可能最多延遲 30 秒感知變更，嚴格即時撤權須另行採用服務端 revocation 訊號，不能聲稱現有 30 秒快取達到即時撤權。曾用 `silver.lo3rwang.count` 測到 189 次 `api.manage()` RPC 呼叫，但不代表 189 次獨立 HTTP/SQL Request；診斷用會寫入的函式已從 `api.manage()` 移除並恢復 `STABLE`，既有觀測記錄保留。不可拿這組舊數字驗收新版本。
- **發布驗收：** 需在已登入管理員、未登入訪客各測一次；檢查首頁小修改按固定 Save 後內容留在畫面且可重載，切換四功能並無額外 Save，文化存檔後時間線更新，搜尋有日期且不重複導頁／讀取，失敗時不得顯示假成功。此修復不保證未量測的搜尋 SQL 一定低於任何指定秒數。

## 2026-11-05 公開訪客資料庫路由隔離

- 公開 AppShell 移除資料庫切換按鈕和資料庫拓樸資訊；一般使用者只能看到不含連線來源的故障提示。
- 客戶端路由不再讀取 browser localStorage 的緊急主庫覆寫值，阻止未登入訪客選擇另一個 LOC 主資料庫。
- 系統 Admin 的 DatabaseTarget 管理頁和 Gateway `checkAdminRole` 保留；資料庫權限驗證不能由公開 UI 取代。
- 此修復不更動資料庫 Schema、RLS、管理權限或既有連線設定。

# LOC Admin 認證來源連線設定

## 管理入口

LOC `/admin/?section=network` 的「網路設定」下整合「資料庫連線 → ISR 快取 → 認證來源設定」三個區塊，沿用既有 Admin 工作區、Clerk Session、LOC Authority root 授權與加密 Durable Object，不新增 SQL 表或欄位。舊連結 `/admin/?section=enterpriseAuth` 透過別名轉往 `network`，不再顯示獨立認證選單。

目前正式登入來源維持 **Clerk**。管理介面可保存以下來源的連線參數：

- GitHub OAuth：Client ID、Client Secret、Callback URL。
- OIDC：Issuer URL、Client ID、Client Secret、Callback URL。
- Microsoft Entra ID：Tenant ID、Client ID、Client Secret、Callback URL。
- Neon Auth：Auth URL（/auth）、Data API URL（/rest/v1）、LOC Callback URL；不要求另外提供 Client Secret，Neon 端自行管理第三方登入憑證。
- LDAP / AD DS：經由企業自行管理的 **OIDC bridge**，填寫 bridge issuer、client ID / secret、Callback URL；瀏覽器不接受網域帳密或 Bind Password。

## API 與憑證保存

- `GET /v1/auth/providers`：僅受信任的 LOC recovery root 可讀。回傳各來源的配置狀態、非機密欄位與 `secret_configured`，不回傳 Secret。
- `PUT /v1/auth/providers/:type`：同樣需要有效的 Clerk 簽章與 recovery root；僅接受白名單欄位，校驗 HTTPS Callback 必須屬於 LOC Origin。
- Client Secret 僅在編輯期間存於 React 記憶體，透過 HTTPS Bearer 傳至 Authority，採既有 AES-GCM `LOC_CONTROL_ENCRYPTION_KEY` 加密後存入既有 `LOC_AUTHORITY_STATE` Durable Object。
- 後續調整可將 Secret 留白，保留原本加密值；不將 Secret 存入 Galaxy、Scope/LOC SQL、前端設定、URL 或 PR。

## 啟用邊界

**設定已保存 != 已接通登入。** 管理頁的非 Clerk 來源仍標記 `runtime_connected:false` 和 `active:false`。本次不提供從前端直接切換啟用的 API，避免未建置 Callback、Token 驗簽、Session 生命週期、SQL/Kysely 管理身份識別與帳號綁定前，就把既有管理員鎖在系統外。

真正啟用任一來源之前必須具備：
1. 對應的登入與 callback adapter；完整的 state / PKCE、issuer / audience / nonce 驗證或 GitHub 的 code exchange 與獨立 LOC session。
2. 與 Clerk 使用者明確綁定的 LOC immutable identity；不可僅憑相同 email 取得既有管理權限。
3. LOC Authority、MCP、Kysely Edge / SQL RLS 的相容權限檢查與回切測試，不能讓新來源的 Access Token 冒充 Clerk JWT。
4. 雙向切換的整合測試與部署驗證；Cloudflare Pages 部署不代表獨立 Authority Worker 已更新。

## 本次最小檢查

`node --test scripts/test-loc-auth-provider-settings.mjs`

這份測試覆蓋來源欄位契約、Secret 脫敏、保留既有 Secret、拒絕外部 callback、拒絕偽造 active 欄位與 LDAP/AD OIDC bridge 規則。不得把欄位測試結果當成 OAuth 已完成端到端登入驗證。

## 與 Supabase Auth、資料庫路由的界線

- **LOC 登入不使用 Supabase Auth**：現行可用認證保持 Clerk → LOC Authority；資料庫仍可用 Supabase、Neon 或其他目標。
- `db-contract.mjs` 不再把資料庫 Auth SDK（包括舊 Supabase Auth 或尚未掛上 Authority 的 Neon Auth）視為可登入 LOC 的回退來源。
- 既有獨立 Neon Auth Adapter 保留作為後續整合基礎，尚未掛入 LOC 正式登入，避免繞過 Authority 或 SQL RLS。
- LOC Authority 的授權不是「讀到 JSON 就允許操作」：Recovery root 的簽章驗證、Durable Object 的 JSON grants、Scope SQL 的管理權限與 RLS 各自具有獨立驗證責任。管理員修改設定 JSON 不應直接獲得 Scope 權限。
- **所有 Auth 的切換只能由授權管理員明確手動啟用**，禁止根據服務失聯自動切換，也禁止儲存連線資訊就自動變更現行 Session。
- 初次發布新的 Admin／Authority 設定程式需要部署包含此 API 的網站及獨立 Authority Worker。其後設定資料保存在運行時 Durable Object，可以即時讀回而不需每次改設定都重新建置；但只有真正接上運行時切換的 Provider 才能在不部署的情況下改變登入行為。
- `NEXT_PUBLIC_*` 建置環境變數和 Cloudflare Worker secrets 不能當成可立即反映的 JSON：變更後應按相關部署機制重新發布。網站的可攜 DB 連線亦應走受信任 runtime 設定而不是前端配置。

## Neon 進度：Schema 與 RPC 分開驗收（2026-11-04）

- Neon `silver` 目前可讀到 **17 張基礎資料表**，其中 Galaxy 2 張、Anchor 2 張；現有 `silver` routine 75 筆。這只證實資料庫中已有結構和函式，**不代表 RPC 與 Supabase 完全相容**。
- 使用者確認 Neon Schema 已完成；待處理的是 RPC 的功能契約、參數、權限及 Kysely 呼叫路徑。不得再以「Neon Schema 尚未同步」為 Auth 設定功能的前置阻礙。
- Neon Auth 的「設定欄位已預留」與「登入來源可安全切換」仍是不同驗收項目。完成 RPC 也不會自動啟用 Neon Auth，依然需要 Authority 驗簽、Session 綁定及手動切換。

## Admin 版型與操作

- 認證設定直接呈現在 Admin `network` 分頁內，與 `DatabaseTarget`、`IsrDomainTarget` 同級，沿用 `ManagementWorkspaceFrame`、`ManagementSectionNav`，不另開全寬版型或獨立 CSS 規則。
- Provider 下拉沿用其他 Admin 編輯器的 `admin-inline-select` + `loc-settings-select`，響應式長寬交由 `settings-select.css` 管理。
- 欄位使用既有 `scope-management-fields` 雙欄網格；網址與 Secret 使用 `scope-management-wide-field` 跨欄，在手機斷點自動改為單欄，避免長 URL 導致橫向捲動。
- 與其他管理頁一致，由原有 `useEditDockForm` 的「儲存／取消」流程管理草稿。不另外顯示重複儲存按鈕；跨來源切換時若有未儲存輸入須先確認放棄。
- 儲存時不只檢查寫入回傳，還重新讀取 Authority 的已遮蔽設定並核對非機密欄位；未成功不得顯示已儲存。讀取／儲存不會啟動新的登入來源。

## 2026-11-06｜管理權限失敗統一回 LOC Clerk 登入頁

- 網站設定（桌面版）的「登入／登出後再登入」固定使用既有 `/login/index.html` 的完整視覺；沒有新增第二套簡化的登入 UI。Capacitor Native 保留原有登入流程。
- Scope／Group 的 `ManagementAccess` 與系統 `AdminHomeView`，對未登入、Scope 管理權限不足、核驗失敗或編輯 Session 逾期的入口，一律導回完整 Clerk 登入頁，並透過同源 `return_to` 保留原來管理頁的網址。禁止顯示「權限過期」或重新驗證對話框；保護中的編輯內容未通過權限之前不掛載。
- Clerk 登入頁只做**身分**核驗，不能把身分核驗誤當作 Scope／Group／Admin 管理權限；從頁面返回時會以 sessionStorage 的**非憑證**標記辨識本次流程，必須在目標管理頁重新執行現有 `useAccount.refresh` 及權限檢查。通過才重建編輯 Session 並進入編輯；拒絕仍返回登入頁，不修改 RLS 或提供隱藏的後門。
- Scope 首頁「進入編輯模式」按鈕的點擊流程由原本的獨立功能維護；本次只修正管理頁的授權失敗出口與登入頁返回流程，避免重複修改。
