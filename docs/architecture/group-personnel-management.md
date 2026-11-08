# Group 人員設定與 Admin 系統設定整併（2026-11-06）

- Group「人員作品管理 → 人員」為人員顯示名稱編輯的唯一一般入口，沿用 `LocGroupMemberList` 及既有群組權限 RPC。
- 系統管理員於**同一 Group 人員作品管理**另看到「系統人員配置」子分頁，沿用 `AdminRegistry` 建立／刪除人員、Email 與 Table Mapping、群組部署管理；Group 一般管理者不載入該元件，資料庫權限不變。
- Admin「系統管理」移除重複「人員」分頁，僅保留系統名單（僅 Email 黑名單）、網路、匯入匯出、頁面區塊及配色等管理項目；舊 `section=registry` 相容轉向 `lists`，不破壞書籤。
- 浮空編輯鍵的「系統管理」只對已經驗證 `canManageGlobalSync()` 的 Admin 顯示。Group 管理者隱藏該鍵，改為五鍵佈局。驗證狀態由 `ManagementAccess` 傳給 EditDock，**不在 AppShell 新增權限查詢**。
- 不變更 Schema、RPC、MCP、Kysely、Clerk／Authority 權限；仍使用原有浮空儲存動作與儲存失敗提示。
