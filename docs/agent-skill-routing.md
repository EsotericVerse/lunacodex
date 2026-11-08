# LOC Agent 能力路由與 Skill 去重紀錄

> 2026-11-01；依使用者本次明確授權整理。本文按需讀取，`AGENTS.md` 不全文預載路由表。Claude 與 Codex 共享最高判別原則「審時度勢」，不得用某一個 Plugin 的通用流程取代。

## 現行補充入口（2026-11-09）

| 任務 | 優先讀取 |
|---|---|
| LOC 需求持續完成與跨對話續作 | 已安裝的 `loc-finish-request`；未提供時依 AGENTS.md 與本表繼續 |
| SQL、查詢、資料存取與 portable 整合 | [Kysely](../.agents/skills/kysely/SKILL.md) |
| Auth、登入、Session | [LOC 原生 OAuth](../workers/loc-authority/native-oauth.mjs)、[LOC Browser Auth](../app/loc/auth/loc-browser.mjs)；Session／Scope 權限以現行程式與 `AGENTS.md` 為準 |

先檢查當前入口實際存在且可讀；下方歷史路由與清理紀錄不是目前每項能力都存在的保證。按需選一份指引，詳細流程不搬回 AGENTS.md。資料庫授權、部署及中斷恢復語法檢查均以現行 AGENTS.md 與最新使用者指示為準；本索引不擴大授權。LOC Auth 採獨立原生身分認證，Clerk／Supabase Auth 不再是 LOC 執行期依賴；SQL 經既有 Kysely 整合路徑。

## 清理執行範圍

- 移除 `.agents/skills/tdd/` 與 `.claude/skills/tdd/` 共 **8 個檔案**（兩邊各有 `SKILL.md`、`tests.md`、`mocking.md`、`agents/openai.yaml`）。兩個 Agent 都已安裝 Superpowers，TDD、驗證及除錯改由已安裝的 Superpowers 工作流程提供；不另外維護較舊的 TDD 副本，也不要求使用者逐項核准測試 seam。
- 保留 `.agents/skills/`、`.claude/skills/` 其他能力與各自的自動發現入口。此前比對有 39 個同名、Git Tree SHA 相同的目錄，但它們分屬 Codex／Claude 的主要發現路徑，**檔案重複不代表同一會話雙倍載入 Token**。不使用 Windows 相容性不確定的 Git symlink 取代。
- 把原本 `AGENTS.md` 的長篇路由表搬到本文，僅在任務需要時載入。原有資料庫、部署、授權及安全門檻不變；`CLAUDE.md` 仍連結至 `AGENTS.md`。
- Git `scripts/check-bulk-delete.mjs` 的 20 個 D/R 檔案防護維持，**不為本次例外永久放寬**。日後若另一個獲明確授權的提交真正超過門檻，應以原有 `[bulk-delete-ok]` 稽核標記通過，不繞過 hook；本次沒有必要啟用。
- **2026-11-02 第二輪清理（依使用者明確授權）：** 移除 `.agents/skills/brainstorming/`、`.claude/skills/brainstorming/`、`.agents/skills/systematic-debugging/`、`.agents/skills/verification-before-completion/` 共 **20 個檔案**。理由同 tdd 那次——這三個能力 Superpowers（`superpowers:brainstorming`、`superpowers:systematic-debugging`、`superpowers:verification-before-completion`）兩個 Agent 都已安裝，repo 本地副本是重複維護。`sql-optimization-patterns`、`supabase-postgres-best-practices` 等領域知識型 skill 不受影響——Superpowers 是流程方法論（怎麼規劃/怎麼除錯/怎麼驗收），不涵蓋 SQL/Postgres 這類領域內容，不能用 Superpowers 取代，繼續保留本地版本。

## 使用與 Token 原則

1. 從使用者的功能目的判斷專業需求，不等待特定技能名稱。優先已連接的 Plugin、既有程式套件與同一任務已載入的 Skill。
2. Codex 優先 `.agents/skills` 或自己安裝的 Plugins；Claude 優先 `.claude/skills` 或自己安裝的 Plugins。相同能力**每次任務只選最適合的一份完整指引**；不要一次載入各種重疊 UI 或 TDD 全文。
3. 工具本身需提供實作或可核對的量測結果；「已安裝、已列出、已搜尋」不算使用。找到可證實的缺口才使用 `find-skills`／skills.sh 搜尋新方法；不自動安裝重複能力。
4. App（含手機）、匯入、SEO、3D、數據／PELT、文學、歌詞與曲風採相同原則。文學與音樂保留使用者已定義的語義、原始文稿及曲序；創作判斷不能因為有通用工具就覆蓋作者原則。
5. 100 位同時使用者正常操作是驗收目標，**不是未經測量即能保證的性能數字**。測試需包含慢連線、重複請求、錯誤及資源占用；在測試完成前回報未驗證。

## 原 LOC Skill 路由對照（按需查閱）

### Skill 對應優先層級
- **Security：** 新 skill/package → `find-skills`；權限／密鑰／認證以 LOC Native Auth 程式及 `AGENTS.md` 為準；SQL／PostgreSQL → Kysely、ZenStack V3 與 `sql-optimization-patterns`；MCP server → `mcp-builder`。不得因技能建議恢復 Clerk／Supabase Auth 或 Supabase Edge。
- **Portable：** 寫新程式碼前先找既有實作；LOC 詞彙／Scope 邊界／ADR 以 `AGENTS.md` 與 `docs/architecture/` 為準。
- **Loading/UI：** React/Next.js → `vercel-react-best-practices`；不明原因的錯誤/效能 → Superpowers `systematic-debugging`（本地副本已移除，見下）；N+1/慢查詢 → `sql-optimization-patterns`；元件 API → `vercel-composition-patterns`；視覺/互動 → `ui-ux-pro-max`；驗證有沒有真的動 → `webapp-testing`；宣稱修好前 → Superpowers `verification-before-completion`（本地副本已移除，見下）。

## Skill 路由表

| Repository skill | Use it for |
|---|---|
| `.agents/skills/vercel-react-best-practices/SKILL.md` | React/Next.js implementation and performance. |
| `.agents/skills/vercel-composition-patterns/SKILL.md` | Component API design, compound components. |
| `.agents/skills/sql-optimization-patterns/SKILL.md` | N+1, slow SQL, aggregation, EXPLAIN. |
| `.agents/skills/ui-skills-root/SKILL.md` | Selecting a small set of relevant UI skills. |
| `.agents/skills/frontend-design/SKILL.md` | Deliberate visual direction for new/reshaped UI. |
| `.agents/skills/ui-ux-pro-max/SKILL.md` | Layout, color, typography, UX review (`python3 .agents/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`). |
| `.agents/skills/design-taste-frontend/SKILL.md` | Explicit public-page/app-screen redesign; use `references/app-screens.md` for admin screens. |
| `.agents/skills/baseline-ui/SKILL.md` | Quick spacing/hierarchy/typography polish. |
| `.agents/skills/fixing-accessibility/SKILL.md` | Keyboard access, ARIA, contrast, WCAG. |
| `.agents/skills/fixing-metadata/SKILL.md` | Page metadata, social previews, structured data. |
| `.agents/skills/fixing-motion-performance/SKILL.md` | Animation jank, layout thrashing. |
| `.agents/skills/improve-ui/SKILL.md` | Read-only UI audit + implementation plan. |
| `.agents/skills/web-design-guidelines/SKILL.md` | Read-only Web Interface Guidelines review. |
| `.agents/skills/component-canvas/SKILL.md` | Interactive canvas of existing component variants. |
| `.agents/skills/sleek-design-mobile-apps/SKILL.md` | Mobile screens in Sleek / React Native / HTML. |
| `.agents/skills/vercel-react-native-skills/SKILL.md` | React Native / Expo, native modules, mobile performance. |
| `.agents/skills/agent-browser/SKILL.md` | General browser automation and testing. |
| `.agents/skills/browser-use/SKILL.md` | Direct CDP / logged-in-session browser control. |
| `.agents/skills/remotion-best-practices/SKILL.md` | Remotion video/animation workflow router. |
| `.agents/skills/find-skills/SKILL.md` | Discover/install a skill for a real capability gap. |
| `.agents/skills/skill-creator/SKILL.md` | Create/edit/evaluate a skill. |
| `.agents/skills/grill-me/SKILL.md` / `grilling/SKILL.md` / `grill-with-docs/SKILL.md` | Stress-test a plan via interview; `grill-with-docs` also records ADRs. |
| `.agents/skills/improve-codebase-architecture/SKILL.md` | User-invoked architecture review only (`disable-model-invocation`). |
| `.agents/skills/setup-matt-pocock-skills/SKILL.md` | One-time repo setup for engineering skills. |
| `.agents/skills/triage/SKILL.md` | Issue/PR triage. |
| `.agents/skills/prototype/SKILL.md` | Throwaway prototype for a design question. |
| `.agents/skills/hyperframes/SKILL.md` / `hyperframes-cli/SKILL.md` / `hyperframes-registry/SKILL.md` | HyperFrames video authoring, CLI jobs, component registry. |
| `.agents/skills/media-use/SKILL.md` | Media for HyperFrames videos; HeyGen needs user's own key. |
| `.agents/skills/webapp-testing/SKILL.md` | Playwright verification before claiming a UI change works. |
| `.agents/skills/mcp-builder/SKILL.md` | Build/review an MCP server. |
| `.agents/skills/handoff/SKILL.md` | Compact a conversation into a handoff doc. |

這個 repo 另外內建 `sql-optimization-patterns` 的本地副本；同名的 Global 版本跟這份一樣算一個能力，不要自動同步或覆蓋。沒裝在 runtime 或 repo 的 skill 只能當參考讀，不要當成已安裝。**`brainstorming`、`systematic-debugging`、`verification-before-completion` 已於 2026-11-02 移除本地副本，改吃已安裝的 Superpowers plugin（`superpowers:brainstorming`／`superpowers:systematic-debugging`／`superpowers:verification-before-completion`），不要再重建這三個本地目錄。**

## 本次處理後的追蹤

- 第三輪（2026-11-09）：已清除 `skills-lock.json` 的 7 筆失效 Clerk 索引，並將現役 Auth Skill 路由改為 LOC Native Auth；失效的本地 Skill 連結不再列為可用入口。歷史清理紀錄保留作為時間點記載，不代表目前仍安裝。

- 第一輪：經授權的 TDD 副本去重與 Agent 文檔整理；其餘用途不同或 Claude 仍依賴的目錄不刪。
- 第二輪（2026-11-02）：經使用者明確授權，移除 `brainstorming`／`systematic-debugging`／`verification-before-completion` 本地副本——Superpowers **plugin 本身維持已安裝、不動**，只砍跟它重複的本地 skill。`sql-optimization-patterns`、`supabase-postgres-best-practices` 等領域知識型 skill 不在此次範圍內，Superpowers 不涵蓋這些內容，繼續保留。
- 後續若要精簡更多內容，應先比較真實 Skill 觸發／上下文占用，以及實際 Agent 可否找到保留版本，再逐項決定，不再靠同名判斷。
