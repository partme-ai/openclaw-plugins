# OpenClaw 插件 README 统一结构规范

## 1. 目标

每个 `extensions/<id>/README.md` 与 `README.zh-CN.md` 都应让首次访问 npm 的读者在首屏回答四个问题：

1. 这是什么组件；
2. 数据从哪里来、经过哪些阶段、到哪里去；
3. 它负责什么、不负责什么；
4. 如何安装、配置、验证和继续深入阅读。

README 是面向使用者的入口，`doc/` 是面向设计、实现与运维评审的深度资料。README 不复制整篇设计文档，但必须给出足以建立正确心智模型的架构速览。

## 2. 固定阅读顺序

```text
1. 组件定位
       │
2. 一眼看懂（text 架构图）
       │
3. 架构与核心流程（text 流程图）
       │
4. 能力与边界
       │
5. 快速开始
       │
6. 配置入口
       │
7. 运维、安全与故障定位
       │
8. 验证与深入阅读
       │
9. 原有详细说明
```

英文 README 使用相同顺序和等价语义，不能仅保留一个跳转到中文文档的短页。

## 3. 图例策略

### 3.1 README

- 首屏架构图和核心流程图必须使用 `text` 围栏；
- 图中明确输入、组件边界、关键处理阶段和输出；
- 不依赖颜色、JavaScript 或外部渲染器；
- 允许保留已有 Mermaid 作为补充，但不能让 Mermaid 成为理解组件的前置条件。

```text
[外部输入]
     │
     ▼
┌──────────────────────────────┐
│ OpenClaw Gateway 内：plugin   │
│ 1. 校验与策略                 │
│ 2. 转换与执行                 │
│ 3. 持久化与投递               │
└──────────────────────────────┘
     │
     ▼
[外部输出]
```

### 3.2 doc/

深度架构文档继续同时保留字符图与 Mermaid。Mermaid 用于表达复杂时序、状态机和多分支关系，字符图用于快速建立整体结构。

## 4. 单一事实源

| README 信息 | 事实来源 |
|---|---|
| npm 包名、版本、OpenClaw peer | `package.json` |
| 插件 ID、Channel ID | `openclaw.plugin.json` |
| 组件输入、处理阶段、输出、边界 | `scripts/readme-architecture-data.mjs` |
| 标准 README 区块 | `scripts/sync-readme-structure.mjs` |
| 结构门禁 | `scripts/check-readme-structure.mjs` |

更新组件契约后应先修改事实源，再执行：

```bash
pnpm sync-readme-structure
pnpm check-readme-structure
pnpm check-explanatory-assets
```

## 5. 保留原有内容

同步工具只管理 `README_STANDARD_START` 与 `README_STANDARD_END` 之间的标准区块。标记之外的原有配置表、协议说明、示例、FAQ 和故障排查内容继续保留，避免结构统一演变成信息删减。

