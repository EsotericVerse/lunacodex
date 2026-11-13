---
name: security-audit
description: "Review concrete repository security concerns, auth boundaries and code risks; use a targeted audit instead of loading the full audit playbook by default."
---
# Security Audit — 工作入口

按實際需求限定系統邊界與威脅類別。一般程式檢查只看相關程式碼；完整安全稽核才按需讀取完整程序、攻擊類型、報告驗證與相關工具，不預先取得整包內容。

- [完整稽核指引](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/security-audit/SKILL.md)
- [Web／Auth](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/security-audit/WEB-PROTOCOL-AND-AUTH.md)
- [供應鏈與發布](https://github.com/EsotericVerse/moon-runes-pwa/blob/37f76a294203a9d3618b3571b972f5e9e585722c/.agents/skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md)
- 其餘專用文件與工具：`.agents/SKILL-LINKS.md`。

原有測試、驗證腳本不在本機 Skill 目錄；需要時從固定版本 HTTP 連結獲取，先核對來源再執行。
