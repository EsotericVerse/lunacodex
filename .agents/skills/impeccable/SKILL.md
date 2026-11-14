---
name: impeccable
description: "LOC 的專業視覺精修、主題性格、色彩／材質層次與去制式化設計；適用於設計批評、配色、字體、精修、視覺對比與克制的動態敘事。一般功能動線與響應式交互由 ui-ux-pro-max 主導。"
---

# Impeccable — LOC 視覺精修與主題質感

這是與 `ui-ux-pro-max` 同層級的 **LOC 專案輕量 Skill 入口**；參考 [Impeccable 官方專案](https://github.com/pbakaus/impeccable/tree/e1104dd1713c3c7f511a7be8eee78e35e05de33b)（Apache-2.0，來源版本 v4.9.1）。它**不是**完整官方 CLI／Hooks／二進位安裝；那些能力未隨本入口安裝，不可假裝已執行。專用 playbook 只在實際需要時打開 [官方 SKILL.md](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/SKILL.md) 中對應的一份參考檔。

## 適用邊界
- **選這份作主 Skill**：主題區分不明顯、長年深藍漸層、配色過度固定、卡片「塑膠感」、視覺節奏、明暗材質、字體氣質、既有畫面的 critique／bolder／quieter／distill／colorize／polish。
- **改由 UI/UX 主導**：資訊架構、操作流程、表單、觸控、導航、響應式與一般可用性。圖表資料和運作仍歸原功能能力，不因要美化就重寫。
- 選定一份主 Skill；不要因看見 UI/UX、Motion、設計系統或官方 playbook 的連結就自動展開其他 Skill。不得新增預載、背景 Hooks 或自動檢查。

## LOC 視覺設計判準
- **主題要有性格，不是只換色票**：從 `app/styles/tokens.css`、`app/styles/theme-contract.css`、`app/modular/theme-registry.js`、`app/styles/published-themes.css` 與實際渲染出發，檢查背景、表面、光線、字型、邊界、留白、對比是否跟主題一起變化；先辨認固定色與局部覆蓋造成的主題失效。
- **風格濃度適中**：保留 LOC 的意象與符文色彩語意，但不把每一張卡片、邊框、陰影都做成亮面塑膠；避免所有主題又回到同一個深藍漸層。強烈視覺集中於重點，其餘區域讓文字、數字與作品呼吸。
- **Motion 已有自己的角色**：造型變化不可蓋掉導航、轉場與視覺化的動作語意；控制高成本模糊、陰影與多層半透明合成，保留 `prefers-reduced-motion`、低階手機效能與可讀性。
- **使用現有主題資料流**：不擅改持久化結構、主題 ID、符文群組定義、既有 CSS contract 或已驗證的動作。以現有 theme token／selector 精修，避免另造平行 theme 系統。
- **根據工作範圍驗收**：至少比較兩種風格差異明顯的主題，以及桌面與手機的真實畫面；驗收對比度、可辨識度、層次、讀取效能、視覺一致性與互動不退化。沒看過真實渲染不得宣稱視覺品質已通過。

## 按需官方參考
- [Critique](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/critique.md) — 找出制式化與層次問題。
- [Colorize](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/colorize.md) — 配色與重點色。
- [Bolder](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/bolder.md) ／ [Quieter](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/quieter.md) — 調整風格濃度。
- [Distill](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/distill.md) ／ [Polish](https://github.com/pbakaus/impeccable/blob/e1104dd1713c3c7f511a7be8eee78e35e05de33b/.agents/skills/impeccable/reference/polish.md) — 減少浮誇與精修細節。
- 其他官方命令、CLI、腳本和附屬檔案不自動讀取；需要完整官方執行環境時，先評估與 LOC 的 13 入口及 Claude Junction 同步相容性，不直接執行安裝程式。
