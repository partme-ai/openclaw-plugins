# OpenClaw Gotify — 已知不一致与可选修复清单

> 深度解析计划产出；不影响当前 `pnpm test`（97/97 通过）。

## 文档与发布

| ID | 问题 | 位置 | 建议修复 |
|----|------|------|----------|
| DOC-1 | `README.en.md` 不存在 | `package.json` `files`、`README.md` L9 | 将 `README.md` 复制/重命名为 `README.en.md`，或改 `files` 仅含 `README.md` |
| DOC-2 | 语言链接错位 | `README.md`：`[English](./README.en.md) \| [简体中文](./README.md)` | 英文链到 `README.en.md`，中文链到 `README.zh-CN.md` |
| DOC-3 | `README.zh-CN.md` 中文标签指向英文文件 | L13 `[简体中文](./README.md)` | 改为 `./README.zh-CN.md` |
| DOC-4 | `package.json` `files` 含根目录 `setup-entry.js` | 实际构建产物在 `dist/setup-entry.js` | 改为 `dist/setup-entry.js` 或发布前复制 |

## 配置 Schema

| ID | 问题 | 运行时 | Schema（Zod） | 建议 |
|----|------|--------|---------------|------|
| CFG-1 | `inbound.enabled` 默认值不一致 | `config.ts`：`?? Boolean(clientToken)` | `channel-config.ts`：`default(false)` | Schema 改为「未设置时由 resolver 决定」或文档说明 UI 默认 false、有 clientToken 时自动开 |

## 代码与架构

| ID | 问题 | 说明 | 建议 |
|----|------|------|------|
| ARC-1 | 双入站映射 | 生产用 `gotifyStreamToUnified`；`mapGotifyToInbound` 仍导出且用于测试/脚本 | 测试改为 SDK；`mapGotifyToInbound` 标 `@deprecated` 或删除 |
| ARC-2 | 未走 message-sdk `/bridge` | 与 MQ 插件统一架构不一致 | 第二期评估：Gotify 需 `runAssembled`/transcript，不宜简单替换为 `dispatchInbound` |
| ARC-3 | dedup key ≠ `unifiedMessageId` | 去重：`${accountId}:${gotifyMessageId}`；上下文 `unifiedMessageId` 为 SDK 新生成 ID | 文档化即可；追踪时以 `MessageSid` / `gotifyMetadata.id` 为准 |
| ARC-4 | 出站非 JSON 信封 | `deliverReply` 发纯文本 + openclaw extras | Gotify 客户端需人类可读；不宜强制 `serializeForTransport` 信封 |

## 优先级建议

1. **P0（文档）**：DOC-1 ~ DOC-3 — 修正 README 链接，避免用户困惑  
2. **P1（发布）**：DOC-4 — npm `files` 与 dist 对齐  
3. **P2（配置）**：CFG-1 — schema 与 resolver 对齐或文档化  
4. **P3（架构）**：ARC-1 ~ ARC-2 — 二期 message-sdk / WeCom 对齐时处理  

## 验证记录

| 命令 | 结果 | 时间 |
|------|------|------|
| `pnpm typecheck` | 通过 | 2026-05-22 |
| `pnpm test` | 9 files, 97 tests passed | 2026-05-22 |
