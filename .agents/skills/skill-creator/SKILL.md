---
name: skill-creator
description: "Create, review, consolidate or improve a skill by task coverage, metadata triggers and focused evaluation; do not treat each package as a skill."
---
# Skill Creator — 工作入口

技能按**工作能力**整理，不隨依賴模組逐一增加。新增／合併 Skill 時先確認需求、觸發條件、能力重疊與是否有必要新增入口；已被主 Skill 涵蓋的部分做成 HTTP 連結即可。

需評測、驗證格式、生成示例或執行打包工具時，才查原始文檔與指定腳本：

- [完整 Skill Creator 工作流程](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/skill-creator/SKILL.md)
- [格式參考](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/skill-creator/references/schemas.md)
- [快速驗證工具](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/skill-creator/scripts/quick_validate.py)
- 其餘評測、腳本、資源：`.agents/SKILL-LINKS.md`。

腳本需明確取回到臨時執行環境並核對來源，不在啟動時抓取整包。
