# Agent Skills

在此目录放置 Agent Skill 资产（每个 skill 一个子目录，含 `SKILL.md`）。

- 官方约定：manifest `skills[]` 或 `package.json` 声明
- 结构规范：[OpenClaw Plugin Structure §9](../../doc/OpenClaw-Plugin-Structure-Standard.md)

> **脚手架说明**：本目录及 `src/*/.gitkeep`、`hooks/`、`test/e2e/` 为 `new-plugin.mjs` 复制用占位。
> 插件创建后若无 Skill / Hook / E2E 资产，**MAY 删除**整个目录；Base Profile MUST 文件（§5.1）才是硬要求。
