# Galaxy Markdown v1 — AI 匯出與 LOC 匯入格式

LOC iPhone 版的「設定 → 文件匯入 → 要將檔案內容匯入 SQLite 嗎？Yes」可選取 `.md`，
預覽後由使用者確認寫入本機 `local_galaxy`；一般 Markdown（沒有檔頭）也可以匯入。
不需要雲端帳號或自行架設資料庫。本功能不會將手機的原始文件送往 Supabase。

## 給 AI 的匯出指示

請把目前已確認的討論要點整理為**一篇完整文件**，以 UTF-8 Markdown（`.md`）匯出。
使用下列 `galaxy-md/v1` 格式，填入明確標題、實際日期、內容來源與正文；
區分使用者已決定的事項、助理建議及仍未解決的問號。
不要杜撰內容、時間、作者、連結或資料庫主鍵；如無主鍵則**省略 uid**。
不要附加 ChatGPT 或其他 AI 的隱藏系統資訊或個資。
請提供可實際儲存的 `.md` 檔案供匯入。

## 匯入語系選擇（不要求使用者選編碼）

- 文件匯入頁會顯示「匯入語系」，**預設繁體中文**；可選簡體中文、英文或日文。
- 對 Markdown、JSON、CSV、TSV、HTML、TeX 等文字格式，優先嘗試 **UTF-8**；UTF-8 可包含繁簡中文、英文與混合文字，無需個別辨識。
- 無法以 UTF-8 正確解碼時，依所選語系嘗試舊式文字編碼：**繁體中文 → Big5；簡體中文 → GB18030**（英文／日文亦有其對應舊式編碼）。有 BOM 或顯著 UTF-16 特徵時優先依 Unicode 解碼。
- 已選檔案切換語系會重新解析，並在**預覽確認前**顯示文字；若文字顯示異常，先改選正確的匯入語系。
- **只處理文字解碼，不翻譯，也不將語系寫入 Galaxy 的任何文章欄位。** SQLite 儲存解碼後的 Unicode TEXT；一般 SQLite 預設以 UTF-8 儲存。
- PDF、DOCX、XLSX 等複合／二進位文件仍交由既有格式解析套件處理；不承諾這個語系選項可以修正它們所有內部編碼問題。
- AI 產生新 Markdown 時仍優先輸出 UTF-8，舊 Big5 文件可透過同一入口匯入。

## 格式範例

```md
---
loc_format: galaxy-md/v1
title: "時空靈魂震盪論：討論摘要"
created_at: 2026-10-24
site: chatgpt
searchable: true
statistics_able: true
---

# 時空靈魂震盪論：討論摘要

## 已確認要點

- 時間與情境定錨後，多線探索，再同步檢討與修正探索方式。
- 同時觀察命中、未命中與意外發現，不把推測當成證據。

## 尚未解決的問號

- ...
```

## 原始來源 site 標記

`site` 依**原始資料從哪裡產生**決定，而不是使用哪種 MCP／API 寫進資料庫。例如：

- GitHub PR／Issue／Commit → `github`
- ChatGPT 對話及帳戶資料匯出 → `chatgpt`
- Supabase 本身的維運／SQL 操作紀錄 → `supabase`
- MCP 自身連線、權限、工具實測紀錄 → `mcp`
- Facebook、Threads、Instagram、Suno 等原始匯入 → 沿用各自來源名稱

若透過 Supabase MCP 儲存 GitHub PR，仍記錄 `site: github`；使用 LOC MCP 儲存 ChatGPT 對話，仍記錄 `site: chatgpt`。平台來源不明時不要自行推定或批次覆寫。已存在的 `site_id` 應保留原始平台真實 ID。

## 支援的檔頭欄位

| 欄位 | 說明 |
| --- | --- |
| `loc_format` | 若填入，必須是 `galaxy-md/v1` |
| `title` | 文章標題；省略時取第一個 `# 標題` 或檔名 |
| `created_at` | 原文日期，例如 `2026-10-24` 或完整 ISO 8601；也接受 `createtime` |
| `site` | 原始內容的來源平台（非使用的匯入工具），預設從來源選擇欄帶入，可在匯入前修改 |
| `location` | 選填地點 |
| `searchable` | `true` 或 `false`，預設 `true` |
| `statistics_able` | `true` 或 `false`，仍遵守 LOC 原有的可搜尋與純網址判斷 |
| `uid` | 選填，若指定必須是 8 個英數字；通常由 LOC 自動產生 |

- 檔頭需使用 `---` 開頭與結尾，僅支援**單行純量** `key: value`；複雜 YAML 物件／陣列不屬於 v1。
- 正文保留原始 Markdown 標記與段落，不轉成純文字；檔頭本身不進入正文。
- **一般 `.md` 不要求檔頭**；其 Markdown 正文仍可匯入。
- 未指定 UID 時，以**完整檔案內容**的 SHA-256 派生固定 8 字元 UID；相同檔案重匯會沿用 UID，既有匯入程式會跳過相同 UID。若修改內容，會產生新的 UID（視為另一份文件），不是覆蓋原文章。
- 指定相同 `uid` 的文件再次匯入也會跳過，並不更新已存在文章。要修改既有內容應使用 Galaxy 的編輯流程。
- 匯入仍採 LOC 現有的「預覽 → 人工確認 → 寫入」流程；重複與格式錯誤會在匯入畫面呈現。原有 128 MiB 單檔解析上限適用。
- 目前的 UI 是**選擇檔案匯入**，不是 ChatGPT 直接連線修改 iPhone 的 SQLite。
