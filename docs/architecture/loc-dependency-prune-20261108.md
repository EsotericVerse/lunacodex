# LOC npm 實際使用依賴清理（2026-11-08）

本次以 `main`（基準 SHA `8f0ed71bc45659fcf1bc3553feef7ad43df38f80`）的 `package.json`、`package-lock.json`、應用程式、服務端、CLI／測試及建置設定為依據。判定時排除文件或 Skill 內的教學範例引用，不以「搜尋不到靜態 import」單獨推論未使用。

## 已移除：確認沒有實際功能引用的直接依賴

- `@react-three/fiber`
- `@react-three/drei`
- `@react-three/postprocessing`
- `postprocessing`
- `opentype.js`

現有 3D 符文畫面使用 `three`、`motion/react`、`EffekseerStage` 與原生 React，而非 React Three Fiber／Drei／Postprocessing。這些套件在原 repo 的實際程式中沒有 module import；`@react-three/fiber` 與 `@react-three/drei` 僅出現在升級版本契約測試中，因此同步調整該測試，不對產品功能做替代實作。

## Lockfile 清理

以 npm lockfile v3 的 `dependencies`／`devDependencies`／`optionalDependencies`／`peerDependencies` 解析套件可到達性，保留所有仍受其他依賴引用的套件。刪除上述 5 個直接依賴後，另有 52 個 lockfile 項目不再被需要；再移除原本就沒有依賴者的 `iceberg-js`。總計刪除 53 個 lockfile 節點，從 833 個（含根節點）縮減到 780 個。

移除 5 個直接依賴並不等於刪除 53 個 npm 頂層依賴：後者包含間接依賴與不同層級的版本。

## 保留（實際使用或必要工具／peer dependency）

- `three`、`motion`：目前 3D 顯示與動態效果的實際程式引用
- `@mui/material` 與 `@emotion/react`／`@emotion/styled`：MUI 與其 peer dependencies
- `@capacitor/ios`、`@capacitor/cli`：iOS 平台與 Capacitor CLI，無須被前端程式 import
- `kysely`、`@zenstackhq/orm`、`@zenstackhq/schema`：跨資料庫查詢及契約
- `flexsearch`：已安裝並處於獨立索引整合工作中，不依本次靜態引用數量刪除
- `maplibre-gl`、`recharts`、`vis-network`、`vis-timeline`、`sql.js`、`officeparser`、`jsonpath-plus`、`@blocknote/*` 等：已找到 CSS、應用程式或動態 import／功能讀取的引用

## Skills 不等同 npm runtime

`.agents/skills` 及 `.claude/skills` 是 Agent 專業知識／發現入口，不能用是否被 JavaScript `import` 作為刪除依據。兩個入口的同名 Skill 亦可能需要供不同 Agent 發現；不把 Git 內容重複直接等同執行時載入。本次不刪除 Skills 或改動 `skills-lock.json`。

## 驗證與界限

- 變更後已重新讀取 GitHub 分支上的 manifest、lockfile 和測試檔，確認 JSON 可解析、根層 dependencies/devDependencies 與 package.json 一致，五項移除及核心依賴保留。
- `scripts/test-module-native-upgrade.mjs` 已調整升級套件檢查，並加上已退休依賴未被重新引入的契約檢查。
- **尚未執行 `npm ci` 或 Next.js build**：目前操作端沒有可連到 GitHub/npm 的專案 npm 執行環境。鎖定檔依賴圖核對不等同完整安裝／編譯測試，故不宣稱功能驗收通過。
- PR #1210／#1216 同時修改 `package.json` 的 script 區塊；本批只刪 dependencies，合併時仍需以最新 `main` 的 scripts 為準。無任何資料庫、部署或權限設定變更。
