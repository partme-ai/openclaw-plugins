# openclaw-plugins — 插件结构架构规范

> **版本**：1.0  
> **状态**：Normative（规范性）  
> **范围**：`openclaw-plugins/extensions/*`  
> **规范词**：MUST / MUST NOT / SHOULD / MAY  
> **运行时契约**：`spec/PLUGIN_SPEC.md`

## 1. 概述

本规范定义 OpenClaw 插件包的**目录契约**、**入口边界**、**模块分层**与**结构治理**。所有 Channel 插件 MUST 满足 Base Profile；复杂度超阈值的 Channel 插件 MAY 叠加 Extended Profile 语义目录。

### 1.1 文档定位

| 维度 | 说明 |
|------|------|
| 与架构文档关系 | [OpenClaw-Plugins-Architecture_CN.md](./OpenClaw-Plugins-Architecture_CN.md) 描述五层业务架构；本文档描述**单插件包内**的代码与目录架构 |
| 与运行时契约关系 | `spec/PLUGIN_SPEC.md` 定义 SDK 注册与生命周期；本文档定义**文件落位**与**职责边界** |
| 校验基线 | `scripts/check-plugin-structure.mjs` 以 Base Profile 为 MUST 集、Extended Profile 为 SHOULD 集执行漂移检测 |

### 1.2 适用对象

| 插件类型 | Base Profile | Extended Profile | 说明 |
|----------|:------------:|:----------------:|------|
| 新 Channel 插件 | MUST | SHOULD（超阈值时） | 自 `scripts/new-plugin.mjs` 生成 |
| 存量 Channel 插件 | MUST | MAY | 渐进对齐，不阻断 default 模式构建 |
| Capability / Infra / SDK | MUST（根目录 + manifest） | MAY | `src/` 按领域收敛，不强制 Channel 平铺文件 |
| 构建产物 | — | — | `dist/`、`node_modules/` MUST NOT 作为结构依据或提交 |

---

## 2. 结构总览

插件包采用 **Base Profile（必选骨架）+ Extended Profile（可选语义层）** 双层模型：

```
┌─────────────────────────────────────────────────────────────┐
│  插件根目录 — Manifest / Package / 构建 / 文档 / 资产        │
│  openclaw.plugin.json  package.json  tsconfig  tsup  vitest │
│  README*  LICENSE  .gitignore  hooks/  skills/  test/       │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Base Profile — src/ 平铺入口与通道边界（MUST）              │
│  index.ts ──→ channel.ts ──→ inbound / outbound             │
│  setup-entry.ts ──→ channel-setup-factory / onboarding      │
│  runtime.ts  config.ts  types.ts  transport/server.ts        │
└────────────────────────────┬────────────────────────────────┘
                             │ 复杂度超阈值 MAY 叠加
┌────────────────────────────▼────────────────────────────────┐
│  Extended Profile — src/{语义目录}/（SHOULD）                │
│  channel  config  dispatch  webhook  outbound  runtime       │
│  agent  tools  mcp  media  state  shared  types  <domain>/   │
└─────────────────────────────────────────────────────────────┘
```

**双入口模型**（运行时与 Setup 冷路径分离）：

```
                    openclaw.plugin.json
                    package.json#openclaw
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
   extensions[]                    setupEntry
   ./dist/index.js                  ./dist/setup-entry.js
           │                               │
           ▼                               ▼
   defineChannelPluginEntry         defineSetupPluginEntry
   registerFull / setRuntime        仅 ChannelPlugin 导出
   inbound · outbound · transport   setupAdapter · wizard
```

---

## 3. 设计目标

| 目标 | 规则 |
|------|------|
| Manifest-first | `openclaw.plugin.json` 为插件身份与配置 schema 的唯一声明面 |
| Thin entry | `src/index.ts` 仅负责注册、runtime 注入、编排；MUST NOT 承载 API 调用体与持久化 |
| 冷温路径分离 | Setup（`setup-entry.ts`）与运行时（`index.ts`）MUST 使用独立编译入口 |
| 语义内聚 | 业务能力按职责归入命名模块；MUST NOT 使用 `utils/`、`helpers/`、`common/` 兜底 |
| 可治理 | 目录结构 MUST 可被 `check-plugin-structure.mjs` 与 CI 自动校验 |
| 渐进扩展 | Base 先成立；Extended 仅叠加，不替换 Base 入口文件 |

---

## 4. Base Profile — 根目录契约

### 4.1 目录树

```text
extensions/<plugin-id>/
├── openclaw.plugin.json          # MUST — 身份、channels、configSchema
├── package.json                  # MUST — openclaw.extensions[]、setupEntry
├── tsconfig.json                 # MUST
├── tsup.config.ts                # SHOULD
├── vitest.config.ts              # SHOULD
├── .gitignore                    # SHOULD
├── LICENSE                       # SHOULD
├── README.md                     # MUST
├── README.zh-CN.md               # SHOULD
├── README.en.md                  # MAY
├── clawdbot.plugin.json          # MAY — 兼容别名 manifest
├── moltbot.plugin.json           # MAY — 兼容别名 manifest
├── hooks/                        # MAY — 生命周期钩子资产
│   └── .gitkeep
├── skills/                       # MAY — Agent Skill 资产
│   └── README.md
├── src/                          # MUST — 全部运行时代码
└── test/                         # SHOULD
    ├── *.test.ts
    └── e2e/
        └── .gitkeep
```

### 4.2 根目录 MUST / MUST NOT

| 项 | 级别 | 说明 |
|----|------|------|
| `openclaw.plugin.json` | MUST | 声明 `id`、`channels`、`configSchema`；MUST NOT 声明代码入口 |
| `package.json#openclaw.extensions[]` | MUST | 指向 `./dist/index.js`（或等价编译产物） |
| `package.json#openclaw.setupEntry` | MUST | 指向 `./dist/setup-entry.js`；MUST NOT 复用运行时入口 |
| `package.json#openclaw.channel` | SHOULD | Channel 元数据（id、label、install） |
| Manifest `id` | MUST | 与目录名 `<plugin-id>` 一致，kebab-case |
| 插件根目录 `*.ts`（运行时） | MUST NOT | 除 `tsup.config.ts`、`vitest.config.ts` 外，运行时代码 MUST 在 `src/` |
| `dist/`、`node_modules/` | MUST NOT | 提交仓库或作为架构文档依据 |
| `*.tgz` | MUST NOT | 提交插件包 |
| 插件级 `pnpm-lock.yaml` | SHOULD NOT |  monorepo 使用根锁文件 |
| 兼容 manifest | MAY | `clawdbot.plugin.json`、`moltbot.plugin.json`；存在时 SHOULD 以 `openclaw.plugin.json` 为准 |

---

## 5. Base Profile — src 骨架

### 5.1 必选文件

| 路径 | 级别 | 职责摘要 |
|------|------|----------|
| `src/index.ts` | MUST | `defineChannelPluginEntry`、runtime 注入、`registerFull` 编排 |
| `src/channel.ts` | MUST | `ChannelPlugin` 定义、capabilities、gateway 声明 |
| `src/channel-setup-factory.ts` | MUST | setupAdapter、setupWizard |
| `src/setup-entry.ts` | MUST | `defineSetupPluginEntry` 轻量入口 |
| `src/onboarding.ts` | MUST | Setup 导出面 |
| `src/runtime.ts` | MUST | Runtime setter/getter |
| `src/inbound.ts` | MUST | 入站解析、去重、ingress |
| `src/outbound.ts` | MUST | 出站消息适配 |
| `src/config.ts` | MUST | 配置解析、默认值、校验 |
| `src/types.ts` | MUST | 插件领域类型 |
| `src/transport/server.ts` | MUST | Webhook、HTTP、Broker、长连接 I/O |

### 5.2 Extended 占位目录（`_template` 参考）

`extensions/_template` 在 `src/` 下预置语义目录占位（`.gitkeep`），供 `new-plugin.mjs` 生成新插件时使用。**占位目录不是 Base Profile 的 MUST 项**；存量或已迁移插件 MAY 省略未使用的空目录。

```text
src/
├── …（Base 平铺文件，见 §5.1 — 这些是 MUST）
├── transport/server.ts           # MUST
├── channel/.gitkeep              # _template 参考；实现后替换或删除占位
├── config/.gitkeep
├── dispatch/.gitkeep
├── …
└── webhook/.gitkeep
```

| 规则 | 级别 | 说明 |
|------|------|------|
| Base MUST 平铺文件（§5.1） | MUST | 所有 Channel 插件必须满足 |
| `_template` 内 Extended 占位 | SHOULD | 供脚手架复制；新插件创建后 MAY 删除未用占位 |
| 已迁移插件缺少空 `.gitkeep` 目录 | — | MUST NOT 视为违规；校验仅关注 §5.1 与 `src/` 根漂移 |
| 语义目录有真实代码 | SHOULD | 保留对应目录；删除仅含 `.gitkeep` 的无用占位 |

---

## 6. 模块职责矩阵

| 模块 | MUST 做 | MUST NOT 做 |
|------|---------|-------------|
| `openclaw.plugin.json` | 声明身份、配置 schema、能力 | 声明代码入口路径 |
| `package.json#openclaw` | 指向编译后双入口 | 指向未编译 `.ts` 或临时文件 |
| `src/index.ts` | 注册 Channel、注入 runtime、编排 registerFull | API 调用体、Tool execute、持久化 |
| `src/channel.ts` | ChannelPlugin、capabilities、gateway | 注册 HTTP 路由、注册 Tool |
| `src/channel-setup-factory.ts` | setupAdapter、setupWizard | 运行时 I/O、消息分发 |
| `src/setup-entry.ts` | 导出 Setup 用 ChannelPlugin | `registerFull`、runtime 初始化 |
| `src/onboarding.ts` | Setup 流程导出 | 运行时分发逻辑 |
| `src/runtime.ts` | Runtime 存取 | 业务状态持久化 |
| `src/inbound.ts` | 入站解析、去重、ingress | 出站发送 |
| `src/outbound.ts` | 出站适配 | 入站 webhook 处理 |
| `src/config.ts` | 解析、默认值、校验 | 跨模块业务编排 |
| `src/types.ts` | 类型定义 | 可执行逻辑 |
| `src/transport/server.ts` | 传输层 I/O（HTTP/Webhook/Broker） | 领域规则沉淀 |

---

## 7. Extended Profile — 语义分层

Base Profile 必须先成立。Extended Profile 在 Base 之上叠加语义子目录，**不删除** Base 入口文件。

### 7.1 启用条件

| 条件 | 规则 |
|------|------|
| `src/` 根平铺非测试 `.ts` > 15 | SHOULD 启用 Extended |
| 同时承担 webhook、dispatch、outbound、mcp、agent 中 ≥ 3 类职责 | SHOULD 启用 Extended |
| `src/index.ts` > 150 行 | SHOULD 拆分到语义目录 |
| 新增语义目录 | MUST 使用 §7.2 表内名称；MUST NOT 以通用名兜底 |

### 7.2 语义目录职责

| 目录 | 职责 |
|------|------|
| `src/channel/` | ChannelPlugin 拆分、setup API、onboarding |
| `src/config/` | schema、账号、路由、策略 |
| `src/runtime/` | runtime store、probe、gateway 实现 |
| `src/webhook/` | HTTP 回调、签名、加解密 |
| `src/dispatch/` | 入站编排、路由、幂等 |
| `src/outbound/` | 出站投递、重试、限流 |
| `src/agent/` | Agent 辅助能力 |
| `src/tools/` | Control Tool 工厂 |
| `src/mcp/` | MCP proxy、工具桥接 |
| `src/media/` | 媒体下载、上传、转换 |
| `src/state/` | 持久化读写（与 `store/` 二选一，优先 `state/`） |
| `src/shared/` | 纯技术复用（无业务语义） |
| `src/types/` | 类型聚合 |
| `src/<domain>/` | 插件领域模块（kebab-case） |

### 7.3 参考实现

复杂 Channel 插件 `extensions/wecom-kf` 采用 Extended Profile 全量语义分层；新插件 SHOULD 以其目录划分为参考，而非复制其历史平铺文件。

---

## 8. 命名规范

| 对象 | 规则 | 示例 |
|------|------|------|
| 插件目录 / Manifest `id` | kebab-case，二者 MUST 一致 | `wecom-kf` |
| `src/` 子目录 | kebab-case | `dispatch/` |
| 源文件 | kebab-case | `inbound-media.ts` |
| Channel id | kebab-case | `wecom-kf` |
| Tool 名 | `{plugin_id}_{verb}_{resource}`，snake_case | `wecom_kf_send_message` |
| Config 字段 | camelCase | `accountId` |
| 环境变量 | SCREAMING_SNAKE | `WECOM_KF_TOKEN` |

### 8.1 禁止命名

| 名称 | 规则 |
|------|------|
| `src/utils/`、`src/helpers/`、`src/common/` | MUST NOT（顶层及语义层） |
| `misc.ts`、`temp.ts` | MUST NOT |
| `store/` 与 `state/` 并存 | MUST NOT；同一插件 MUST 二选一 |
| `legacy/` | MAY；MUST 含 `README.md` 说明删除条件与负责人 |

---

## 9. 资产目录

| 目录 | 级别 | 约定 |
|------|------|------|
| `test/` | SHOULD | 插件级单元测试；`*.test.ts` 默认位置 |
| `test/e2e/` | MAY | 端到端测试；无 E2E 时 SHOULD NOT 保留空 `.gitkeep` |
| `hooks/` | MAY | OpenClaw 生命周期钩子；无钩子时 SHOULD NOT 保留空 `.gitkeep` |
| `skills/` | MAY | Agent Skill 子目录 + `SKILL.md`；无 Skill 时 SHOULD NOT 保留仅含 `README.md` 的空目录 |

单元测试 SHOULD 置于 `test/`；迁移期 MAY 与 `src/` 共存，但新插件 SHOULD NOT 新增 `src/**/*.test.ts` 作为主位置。

---

## 10. 治理与校验

结构校验脚本：`scripts/check-plugin-structure.mjs`。

### 10.1 校验模式

| 模式 | 命令 | 行为 |
|------|------|------|
| default | `node scripts/check-plugin-structure.mjs` | 漂移以 warn 为主；`_template` 的 Base MUST 缺失为 error |
| strict-base | `--strict` / `--strict-base` | 所有插件 Base Profile MUST 违规导致 exit 1 |
| strict-new | `--strict-new` | `wecom-kf`、`wecom` 的 Extended Profile 违规导致 exit 1 |
| CI 报告 | `--json` | 输出 JSON，供流水线与报表集成 |

### 10.2 规则级别

| 检查项 | default | strict-base | strict-new | 说明 |
|--------|---------|-------------|------------|------|
| Base 根目录 MUST 文件缺失 | warn（`_template`：error） | error | warn | §4.2；含 `tsup.config.ts`、`vitest.config.ts`、`.gitignore`、`LICENSE` |
| Base `src/` MUST 文件缺失 | warn（`_template`：error） | error | warn | §5.1 |
| `openclaw.extensions[]` 缺失 | warn（`_template`：error） | error | warn | — |
| `openclaw.setupEntry` 缺失 | warn（`_template`：error） | error | warn | — |
| Manifest `id` 与目录名不一致 | warn（`_template` 跳过占位符） | error | warn | §4.2 |
| Extended 语义目录缺失（空占位） | — | — | — | 不校验；§5.2 占位为 `_template` 参考 |
| `src/` 根非 Base `.ts` 漂移（Base 插件） | warn（> 5 个） | warn | warn | §7.1；非缺失占位目录 |
| `src/index.ts` > 150 行 | warn | warn | error（`wecom-kf`、`wecom`） | Extended 阈值 |
| `src/` 根平铺非 Base `.ts` > 5 | warn | warn | error（`wecom-kf`、`wecom`） | Extended 漂移 |
| 插件根目录运行时 `.ts` | warn | warn | warn | MUST 迁入 `src/` |
| 顶层模糊命名 / 禁止目录 | warn | warn | error（部分规则，`wecom-kf`、`wecom`） | §8.1 |
| `store/` 与 `state/` 并存 | warn | warn | error（`wecom-kf`、`wecom`） | §8.1 |
| `legacy/` 无 README | warn | warn | warn | §8.1 |
| 兼容 manifest 存在 | warn | warn | warn | MAY 别名 |
| `*.tgz`、`dist/` 已提交（git tracked） | error | error | error | §4.2 |

CI SHOULD 以 Base Profile 为基线执行；新插件与 `_template` 变更 MUST 在 `--strict-base` 下通过。

---

## 11. 参考实现

| 类型 | 路径 |
|------|------|
| Base Profile 骨架 | `extensions/_template` |
| Extended Profile 样例 | `extensions/wecom-kf` |
| 插件生成器 | `scripts/new-plugin.mjs` |
| 结构校验 | `scripts/check-plugin-structure.mjs` |
| 运行时契约 | `spec/PLUGIN_SPEC.md` |
| 业务架构 | `doc/OpenClaw-Plugins-Architecture_CN.md` |

新插件 SHOULD 通过 `node scripts/new-plugin.mjs <plugin-id>` 创建。对 Base Profile 的结构变更 MUST 先落盘于 `_template`，再由生成器与校验脚本承接。

### 11.1 完整示例（`extensions/_template`）

以下为 Base Profile 骨架的**当前目录快照**（不含 `dist/`、`node_modules/`）：

```text
extensions/_template/
├── openclaw.plugin.json          # 身份、channels、configSchema
├── package.json                  # openclaw.extensions[]、setupEntry
├── tsconfig.json
├── tsup.config.ts                # 双入口编译（index / setup-entry）
├── vitest.config.ts
├── .gitignore
├── LICENSE
├── README.md                     # MUST
├── README.zh-CN.md               # SHOULD
├── README.en.md                  # MAY
├── hooks/
│   └── .gitkeep                  # 生命周期钩子占位
├── skills/
│   └── README.md                 # Agent Skill 约定说明
├── src/
│   ├── index.ts                  # defineChannelPluginEntry、registerFull
│   ├── setup-entry.ts            # defineSetupPluginEntry
│   ├── channel.ts                # ChannelPlugin 定义
│   ├── channel-setup-factory.ts  # setupAdapter、setupWizard
│   ├── onboarding.ts             # Setup 导出面
│   ├── runtime.ts                # Runtime setter/getter
│   ├── inbound.ts                # 入站解析、ingress
│   ├── outbound.ts               # 出站适配
│   ├── config.ts                 # 配置解析与校验
│   ├── types.ts                  # 领域类型
│   ├── transport/
│   │   └── server.ts             # Webhook / HTTP I/O
│   ├── channel/.gitkeep          # Extended 占位
│   ├── config/.gitkeep
│   ├── dispatch/.gitkeep
│   ├── webhook/.gitkeep
│   ├── outbound/.gitkeep
│   ├── runtime/.gitkeep
│   ├── media/.gitkeep
│   └── types/.gitkeep
└── test/
    ├── inbound.test.ts           # 单元测试样例
    └── e2e/
        └── .gitkeep              # E2E 占位
```

| 路径 | 职责 |
|------|------|
| 根目录 manifest / package | §4.2 声明面；双入口指向 `./dist/index.js`、`./dist/setup-entry.js` |
| `src/` 平铺 `*.ts` | §5.1 Base MUST 入口与通道边界 |
| `src/*/.gitkeep` | §5.2 `_template` 脚手架参考；插件 MAY 省略未用占位 |
| `hooks/`、`skills/`、`test/e2e/` | §9 可选资产；无内容时 SHOULD NOT 保留空占位 |

---

## 关于 openclaw-plugins

本文档属于 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合。

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施。

> 📧 联系我们：partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)
