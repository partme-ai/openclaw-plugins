# OpenClaw 插件机制完整技术参考

> 本文档基于 OpenClaw 官方文档、本地源码 (`research/openclaw`) 及插件 SDK 实现，提供 OpenClaw 插件系统的完整技术概览。

---

## 目录

1. [概述](#概述)
2. [架构设计](#架构设计)
3. [插件类型](#插件类型)
4. [插件发现与加载](#插件发现与加载)
5. [插件清单 (openclaw.plugin.json)](#插件清单-openclawpluginjson)
6. [package.json 配置](#packagejson-配置)
7. [SDK 入口点](#sdk-入口点)
8. [插件注册 API](#插件注册-api)
9. [Channel 插件 SDK](#channel-插件-sdk)
10. [Provider 插件 SDK](#provider-插件-sdk)
11. [Runtime API 参考](#runtime-api-参考)
12. [Setup 机制](#setup-机制)
13. [测试工具](#测试工具)
14. [插件 Bundle 兼容](#插件-bundle-兼容)
15. [CLI 管理命令](#cli-管理命令)
16. [源码结构与边界规则](#源码结构与边界规则)
17. [SDK 迁移指南](#sdk-迁移指南)

---

## 概述

OpenClaw 插件系统是一个**进程内可扩展架构**，允许第三方开发者通过标准化的 TypeScript SDK 扩展 OpenClaw AI Gateway 的能力。

### 核心设计原则

- **所有权边界**: 一个插件代表一个供应商或功能的所有权边界，而非松散集成的集合
- **能力注册**: 插件通过 `api.register*()` 方法声明式注册能力到中央注册表
- **Manifest 优先**: 配置验证应能从 manifest/schema 元数据完成，无需执行插件代码
- **窄导入路径**: 每个 SDK 子路径是独立的、自包含的模块，避免循环依赖

### 技术栈

- **运行时**: Node.js 22+
- **语言**: TypeScript (ESM, strict mode)
- **测试**: Vitest (co-located `*.test.ts`)
- **构建**: tsdown
- **包管理**: pnpm

---

## 架构设计

### 四层架构

```
┌─────────────────────────────────────┐
│        Surface Consumption           │  ← CLI / Gateway RPC / Web UI
├─────────────────────────────────────┤
│        Runtime Loading               │  ← register(api) 执行
├─────────────────────────────────────┤
│        Enablement & Validation       │  ← plugins.allow/deny/slots
├─────────────────────────────────────┤
│        Manifest Discovery            │  ← openclaw.plugin.json 解析
└─────────────────────────────────────┘
```

### 插件 Shape 分类

加载后，插件按注册行为分为四种 shape：

| Shape | 说明 |
|-------|------|
| **plain-capability** | 单一能力类型 (如仅 provider 或仅 channel) |
| **hybrid-capability** | 多种能力类型组合 |
| **hook-only** | 仅注册 hooks |
| **non-capability** | 仅 tools/commands/services |

### 三层关注点分离

| 层 | 职责 |
|----|------|
| **Core capability layer** | 共享编排、策略、回退、配置合并规则、类型化合约 |
| **Vendor plugin layer** | 供应商 API、认证、模型目录、后端实现 |
| **Channel/feature plugin layer** | 消费核心能力并在特定界面上呈现 |

### 进程隔离模型

**原生插件在 Gateway 进程内运行**——没有沙箱。加载的原生插件拥有与核心代码相同的进程级信任。这意味着：
- 插件 bug 可能导致 Gateway 崩溃或不稳定
- 恶意插件等价于在 OpenClaw 进程内任意代码执行
- 对非捆绑插件推荐使用 allowlist 和显式安装/加载路径

---

## 插件类型

### 按功能分类

| 类型 | SDK 入口 | 用途 |
|------|----------|------|
| **Channel plugin** | `defineChannelPluginEntry` | 连接到消息平台 (Discord, IRC, Telegram, WeChat 等) |
| **Provider plugin** | `definePluginEntry` + `registerProvider` | 添加 LLM、语音、图像/视频生成等 AI 供应商 |
| **CLI backend plugin** | `definePluginEntry` + `registerCliBackend` | 将本地 AI CLI 映射为 OpenClaw 推理后端 |
| **Tool / Hook plugin** | `definePluginEntry` | 注册 agent tools、事件 hooks 或后台 services |

单一插件可以组合多种能力。

### 按分发渠道分类

| 渠道 | 位置 | 信任级别 |
|------|------|----------|
| **Bundled** | `extensions/` (随 OpenClaw 分发) | 完全信任，可访问 safety-critical seams |
| **Community (ClawHub)** | `clawhub:<package>` | 受限 surface，隔离信任边界 |
| **npm** | `npm:<package>` | 过渡期支持 |
| **Local / Git** | `./path` / `git:URL@ref` | 开发阶段 |

---

## 插件发现与加载

### 发现源优先级

当同一 plugin ID 存在于多个源时，按优先级：

1. **Config-selected** — `plugins.entries.<id>` 中钉选的路径
2. **Bundled** — 随 OpenClaw 分发
3. **Global install** — 全局插件目录
4. **Workspace** — 工作区本地

### 加载模式 (Registration Mode)

`api.registrationMode` 告知插件当前加载上下文：

| Mode | 行为 |
|------|------|
| `"full"` | 正常 Gateway 启动 — 注册所有能力 |
| `"discovery"` | 只读能力发现 — 注册 channel + 静态 CLI descriptors；跳过 sockets/workers/clients/services |
| `"setup-only"` | 禁用/未配置 channel — 仅 channel 注册 |
| `"setup-runtime"` | 带 runtime 的 setup — channel 注册 + 轻量 runtime 需求 |
| `"cli-metadata"` | 根 help 捕获 — 仅 CLI descriptors |

`defineChannelPluginEntry` 自动处理这些模式分离。使用原始 `definePluginEntry` 时需手动检查 `api.registrationMode`。

---

## 插件清单 (openclaw.plugin.json)

**每个原生插件必须在插件根目录提供此文件**。OpenClaw 用它来"验证配置而无需执行插件代码"。缺失或无效的 manifest 会阻断配置验证。

格式：JSON5 (支持注释、尾部逗号、无引号键名)。

### 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 规范插件 ID，用于 `plugins.entries.<id>` |
| `configSchema` | object | 插件配置的 JSON Schema。无配置的插件也必须提供 `{ "type": "object", "additionalProperties": false }` |

### 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 可读名称 |
| `description` | string | 简短描述 |
| `version` | string | 信息性版本号 |
| `channels` | string[] | 此插件拥有的 channel ID |
| `providers` | string[] | 此插件拥有的 provider ID |
| `kind` | `"memory"` \| `"context-engine"` | 独占插件类型 |
| `enabledByDefault` | boolean | 捆绑插件默认启用 |
| `enabledByDefaultOnPlatforms` | string[] | 平台特定默认启用 |

### `activation` — 激活规划器

规划器元数据，**非生命周期 API**。不替代 `register(...)`。

| 字段 | 说明 |
|------|------|
| `onStartup` | 是否在 Gateway 启动时必须运行 |
| `onProviders` | 触发激活的 provider ID |
| `onChannels` | 触发激活的 channel ID |
| `onCommands` | 触发激活的 command ID |
| `onRoutes` | 触发激活的 route kind |
| `onConfigPaths` | 存在时触发加载的配置路径 |
| `onAgentHarnesses` | 触发激活的 agent harness ID |

### `contracts` — 静态能力所有权

无需加载 runtime 即可读取的能力声明：

```json
{
  "contracts": {
    "tools": ["my_tool"],
    "speechProviders": ["elevenlabs"],
    "webSearchProviders": ["brave"],
    "agentToolResultMiddleware": ["my-middleware"],
    "externalAuthProviders": ["my-oauth"]
  }
}
```

运行时 `api.registerTool(...)` 注册必须匹配 `contracts.tools`。

### `channelConfigs` — Channel 配置元数据

```json
{
  "channelConfigs": {
    "my-channel": {
      "schema": { "type": "object", "additionalProperties": false, "properties": { ... } },
      "uiHints": { "apiKey": { "label": "API Key", "sensitive": true } },
      "label": "My Channel",
      "preferOver": ["other-channel-plugin"]
    }
  }
}
```

### `setup` — 安装/配置描述符

```json
{
  "setup": {
    "providers": [
      { "id": "my-provider", "authMethods": ["api-key"], "envVars": ["MY_API_KEY"] }
    ],
    "requiresRuntime": false
  }
}
```

### `toolMetadata` — 工具可用性信号

```json
{
  "toolMetadata": {
    "my_tool": {
      "optional": true,
      "configSignals": [{ "rootPath": "tools.allow", "required": ["my_tool"] }]
    }
  }
}
```

### `uiHints` — UI 提示

每个字段支持的 hint：`label`, `help`, `tags`, `advanced`, `sensitive`, `placeholder`。

---

## package.json 配置

```json
{
  "name": "@myorg/openclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "runtimeExtensions": ["./dist/index.js"],
    "setupEntry": "./setup-entry.ts",
    "runtimeSetupEntry": "./dist/setup-entry.js",
    "channel": {
      "id": "my-channel",
      "label": "My Channel",
      "blurb": "Connect to My Platform"
    },
    "providers": ["my-provider"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2",
      "pluginSdkVersion": "2026.3.24-beta.2"
    }
  }
}
```

关键约定：
- `extensions` / `setupEntry` — 源码入口 (workspace/git 开发)
- `runtimeExtensions` / `runtimeSetupEntry` — **安装包的首选**，避免运行时 TypeScript 编译
- 所有 entry 路径必须保持在插件包目录内
- `runtimeSetupEntry` 需要 `setupEntry`，缺失 runtime artifacts 会导致发现失败

---

## SDK 入口点

### `definePluginEntry`

**来源**: `openclaw/plugin-sdk/plugin-entry`

用于 provider、tool、hook 插件及非 channel 的任何插件。

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Does something useful",
  register(api) {
    api.registerTool({
      name: "my_tool",
      description: "Do a thing",
      parameters: Type.Object({ input: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: `Got: ${params.input}` }] };
      },
    });
  },
});
```

可选字段：
- `kind` — `"memory"` 或 `"context-engine"` (独占 slot)
- `configSchema` — 内联 schema 或懒加载工厂函数

### `defineChannelPluginEntry`

**来源**: `openclaw/plugin-sdk/channel-core`

`definePluginEntry` 的包装器，自动调用 `api.registerChannel({ plugin })`。

```typescript
export default defineChannelPluginEntry({
  id: "my-channel",
  name: "My Channel",
  description: "Connect to My Platform",
  plugin: channelPlugin,        // ChannelPlugin 对象
  setRuntime(runtime) { ... },  // 存储 runtime 引用
  registerCliMetadata(api) {    // 仅 CLI descriptors
    api.registerCli(...)
  },
  registerFull(api) {           // 仅 "full" 模式：HTTP routes, gateway methods
    api.registerHttpRoute(...)
  },
});
```

**关键行为**：
- `setRuntime` 在 CLI metadata capture 期间跳过
- `registerFull` 仅在 `api.registrationMode === 'full'` 时运行
- `registerCliMetadata` 在 `"cli-metadata"` / `"discovery"` / `"full"` 模式下运行
- Discovery 模式是 non-activating 但非 import-free —— 顶层导入应无副作用

### `defineSetupPluginEntry`

**来源**: `openclaw/plugin-sdk/channel-core`

轻量级 setup-only 入口，当 channel 禁用或未配置时加载。

### `defineBundledChannelSetupEntry`

**来源**: `openclaw/plugin-sdk/channel-entry-contract`

用于工作区内捆绑 channel 的变体，允许分离 setup 和 runtime surface。

---

## 插件注册 API

`register(api)` 回调接收 `OpenClawPluginApi` 对象：

### api 顶层字段

| 字段 | 类型 | 用途 |
|------|------|------|
| `api.id` | string | 插件 ID |
| `api.name` | string | 显示名称 |
| `api.config` | OpenClawConfig | 当前运行时配置快照 |
| `api.pluginConfig` | Record | 插件特定配置 (`plugins.entries.<id>.config`) |
| `api.logger` | PluginLogger | 作用域日志 (`debug/info/warn/error`) |
| `api.registrationMode` | PluginRegistrationMode | 当前加载模式 |
| `api.resolvePath(input)` | function | 解析插件相对路径 |
| `api.runtime` | PluginRuntime | 运行时 helper 集合 |

### 能力注册

| API 方法 | 注册的能力 |
|----------|-----------|
| `api.registerProvider(...)` | LLM 文本推理 |
| `api.registerChannel(...)` | 消息 channel |
| `api.registerSpeechProvider(...)` | TTS/STT |
| `api.registerRealtimeTranscriptionProvider(...)` | 实时转录 |
| `api.registerRealtimeVoiceProvider(...)` | 实时语音 |
| `api.registerMediaUnderstandingProvider(...)` | 媒体理解 |
| `api.registerImageGenerationProvider(...)` | 图像生成 |
| `api.registerMusicGenerationProvider(...)` | 音乐生成 |
| `api.registerVideoGenerationProvider(...)` | 视频生成 |
| `api.registerWebFetchProvider(...)` | Web 抓取 |
| `api.registerWebSearchProvider(...)` | Web 搜索 |
| `api.registerCliBackend(...)` | CLI 推理后端 |
| `api.registerMemoryCapability(...)` | 内存能力 (统一接口) |
| `api.registerContextEngine(...)` | 上下文引擎 |

### 工具与命令

| API 方法 | 说明 |
|----------|------|
| `api.registerTool(tool, opts?)` | Agent 工具。`{ optional: true }` 表示用户可选启用。必须在 manifest `contracts.tools` 中声明 |
| `api.registerCommand(def)` | 自定义命令，绕过 LLM。可设置 `continueAgent: true` |
| `api.registerCli(registrar, opts?)` | CLI 子命令。提供 `descriptors` 以支持懒加载 |

### 基础设施

| API 方法 | 说明 |
|----------|------|
| `api.registerHook(events, handler)` | 生命周期事件 hooks |
| `api.registerHttpRoute(params)` | Gateway HTTP 端点 |
| `api.registerGatewayMethod(name, handler)` | Gateway RPC 方法 |
| `api.registerGatewayDiscoveryService(service)` | mDNS/Bonjour 广告 |
| `api.registerService(service)` | 后台服务 |
| `api.registerAgentToolResultMiddleware(...)` | **Bundled-only** 工具结果重写 |

### Hook 决策语义

多个 hooks 使用**终止决策** —— 一旦任何处理器返回阻塞/取消结果，低优先级处理器被跳过：

| Hook | 终止条件 |
|------|----------|
| `before_tool_call` | `{ block: true }` 终止; `{ block: false }` = 无决策 |
| `before_install` | 同上 |
| `reply_dispatch` | `{ handled: true }` 终止，跳过默认模型派发 |
| `message_sending` | `{ cancel: true }` 终止 |

---

## Channel 插件 SDK

### `createChatChannelPlugin` Builder

声明式选项构建 channel 插件：

```typescript
const plugin = createChatChannelPlugin({
  base: createChannelPluginBase({ id: "my-channel", setup: { ... } }),
  security: {
    dm: { channelKey: "my-channel", resolvePolicy, resolveAllowFrom, defaultPolicy }
  },
  pairing: { text: { idLabel, message, notify: callback } },
  threading: { mode: "fixed" | "account-scoped" | "custom" },
  outbound: { attachedResults, base: sendMessage },
});
```

### 消息路由

- **`message` Adapter** (新推荐模式): `defineChannelMessageAdapter` + `createChannelMessageAdapterFromOutbound`
- **Live Preview & Finalization**: `message.live.capabilities` (draftPreview, nativeStreaming, quietFinalization)
- **Inbound 路由**: `messaging.resolveSessionConversation(...)` 映射 rawId → conversation + thread
- **Mention 处理**: 两层分离 —— 插件收集证据，共享 `resolveInboundMentionDecision({ facts, policy })` 评估

### 审批能力

旧的 `ChannelPlugin.approvals` 已移除。使用 `approvalCapability` 对象：

```typescript
approvalCapability: {
  authorizeActorAction,      // 规范审批-认证 seam
  nativeRuntime: {            // 拆分为 availability, presentation, transport, interactions, observe
    availability: lazyAdapter,
    transport: lazyAdapter,
  },
  delivery,                   // 仅原生审批路由或回退抑制
  render,                     // 仅 channel 需要自定义审批 payload 时
}
```

### Channel Plugin 生命周期

```
defineChannelPluginEntry → setRuntime → registerCliMetadata → registerFull
                                                                ├── registerHttpRoute
                                                                ├── registerGatewayMethod
                                                                └── start services/clients
```

---

## Provider 插件 SDK

### 注册 Provider

```typescript
api.registerProvider({
  id: "acme-ai",
  label: "Acme AI",
  docsPath: "https://docs.acme.ai",
  envVars: ["ACME_API_KEY"],
  auth: [createProviderApiKeyAuthMethod({
    providerId: "acme-ai",
    methodId: "api-key",
    label: "API Key",
    envVar: "ACME_API_KEY",
    defaultModel: "acme-large",
  })],
  catalog: {
    order: "simple",
    async run(ctx) {
      return ctx.resolveProviderApiKey("acme-ai")
        ? { provider: { baseUrl: "https://api.acme.ai/v1", apiKey: "...", models: [...] } }
        : null;
    },
  },
});
```

### Catalog Order

| Order | Phase | Use Case |
|-------|-------|----------|
| `simple` | First pass | 普通 API-key providers |
| `profile` | After simple | 受 auth profiles 控制 |
| `paired` | After profile | 合成多个 entries |
| `late` | Last pass | 覆盖已有 providers |

### Provider Hooks (42 个有序 hooks)

关键 hooks（按调用顺序）：

1. `catalog` — 模型目录
2. `normalizeModelId` — 模型 ID 别名清理
3. `normalizeTransport` — api/baseUrl 清理
4. `resolveConfigApiKey` — env-marker 认证解析
5. `resolveDynamicModel` — 接受任意上游模型 ID
6. `prepareDynamicModel` — 异步元数据获取
7. `normalizeResolvedModel` — runner 前的传输重写
8. `normalizeToolSchemas` — 注册前的工具 schema 清理
9. `createStreamFn` — 完全自定义 StreamFn
10. `wrapStreamFn` — 自定义 headers/body 包装
11. `buildReplayPolicy` — 转录重放/压缩策略
12. ... (共 42 个)

### Family Builders (预构建 Hook 集合)

```typescript
import { GOOGLE_FAMILY_HOOKS } from "openclaw/plugin-sdk/provider-model-shared";

api.registerProvider({ id: "google", label: "Google", ...GOOGLE_FAMILY_HOOKS });
```

可用的 family builders：
- **Replay**: `openai-compatible`, `anthropic-by-model`, `google-gemini`, `passthrough-gemini`, `hybrid-anthropic-openai`
- **Stream**: `google-thinking`, `kilocode-thinking`, `moonshot-thinking`, `openai-responses-defaults`, `tool-stream-default-on`
- **Tool compat**: `buildProviderToolCompatFamilyHooks("gemini")`

---

## Runtime API 参考

### `api.runtime.agent`

Agent 身份、目录、会话管理。

```typescript
api.runtime.agent.resolveAgentDir(cfg)
api.runtime.agent.resolveAgentWorkspaceDir(cfg)
api.runtime.agent.resolveAgentIdentity(cfg)
api.runtime.agent.resolveThinkingDefault({ cfg, provider, model })
api.runtime.agent.ensureAgentWorkspace(cfg)
api.runtime.agent.runEmbeddedAgent({ ... })        // 启动普通 agent turn
api.runtime.agent.session.resolveStorePath(cfg)
api.runtime.agent.session.loadSessionStore(path)
api.runtime.agent.session.updateSessionStore(path, updater)
```

### `api.runtime.llm`

```typescript
const result = await api.runtime.llm.complete({
  messages: [{ role: "user", content: "Summarize this." }],
  purpose: "my-plugin.summary",
  maxTokens: 512,
});
// → { text, provider, model, usage: { inputTokens, outputTokens, cost } }
```

模型覆盖需要 `plugins.entries.<id>.llm.allowModelOverride: true`。

### `api.runtime.subagent`

```typescript
await api.runtime.subagent.run({ task: "...", deliver: true });
await api.runtime.subagent.waitForRun({ runId, timeoutMs });
await api.runtime.subagent.getSessionMessages({ sessionKey, limit });
```

### `api.runtime.tts`

```typescript
const { audio, sampleRate } = await api.runtime.tts.textToSpeech({
  text: "Hello", provider: "elevenlabs", voice: "Adam",
});
const { audio: telAudio } = await api.runtime.tts.textToSpeechTelephony({ ... });
```

### `api.runtime.mediaUnderstanding`

```typescript
await api.runtime.mediaUnderstanding.describeImageFile({ filePath, prompt });
await api.runtime.mediaUnderstanding.transcribeAudioFile({ filePath, provider });
await api.runtime.mediaUnderstanding.describeVideoFile({ filePath, prompt });
```

### `api.runtime.config`

```typescript
const cfg = api.runtime.config.current();                         // 只读快照
const result = await api.runtime.config.mutateConfigFile({        // 事务性写入
  key: "channels.my-channel.accounts.main.apiKey",
  value: "new-key",
  afterWrite: { mode: "restart", reason: "credentials changed" },
});
// afterWrite: "auto" | "restart" | "none"
```

### `api.runtime.state`

SQLite-backed keyed 存储，重启后存活：

```typescript
const store = api.runtime.state.openKeyedStore<MyRecord>({
  namespace: "tokens", maxEntries: 1000, defaultTtlMs: 3600_000,
});
await store.register("key1", { data: "value" });
const record = await store.lookup("key1");
await store.consume("key1");  // lookup + delete
```

限制：每 namespace `maxEntries`，每插件 1000 行，JSON 值 < 64KB。**当前版本仅 Bundled plugins**。

### `api.runtime.channel`

```typescript
// 媒体
await api.runtime.channel.media.saveRemoteMedia({ url, channelId });
await api.runtime.channel.media.readRemoteMediaBuffer(url);

// Mention 策略
api.runtime.channel.mentions.resolveInboundMentionDecision({ facts, policy });
```

### `api.runtime.system`

```typescript
api.runtime.system.enqueueSystemEvent(event);
api.runtime.system.requestHeartbeat({ reason: "config-changed" });
api.runtime.system.runCommandWithTimeout(cmd, args, opts);
```

---

## Setup 机制

### setup-entry.ts

轻量级入口，当 OpenClaw 仅需要 setup surface 时加载（替代完整入口）：

**加载条件**：
- Channel 禁用但需要 setup/onboarding surface
- Channel 启用但未配置
- 启用了延迟加载 (`deferConfiguredChannelFullLoadUntilAfterListen`)

**setup-entry 应该注册的**：Channel plugin 对象、listen 前需要的 HTTP routes、启动期间需要的 Gateway methods

**setup-entry 不应包含的**：CLI 注册、后台服务、重量级 runtime 导入

### Setup Wizard

Channel 插件通过 `ChannelPlugin` 上的 `ChannelSetupWizard` 对象为 `openclaw onboard` 提供交互式向导：

```typescript
const wizard: ChannelSetupWizard = {
  credentials: [{ inputKey, providerHint, envPrompt, inspect }],
  textInputs: [...],
  dmPolicy: { ... },
  allowFrom: { ... },
  prepare: async (ctx) => { ... },
  finalize: async (ctx) => { ... },
  status: createStandardChannelSetupStatus({ ... }),
};
```

### 可选 Channel Setup Surface

```typescript
import { createOptionalChannelSetupSurface } from "openclaw/plugin-sdk/channel-setup";

const { setupAdapter, setupWizard } = createOptionalChannelSetupSurface({
  channel: myChannel, label: "My Channel", npmSpec: "@myorg/my-plugin", docsPath: "/plugins/my-plugin",
});
```

### Config Schema 构建

```typescript
// Zod → ChannelConfigSchema
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
const schema = buildChannelConfigSchema(accountSchema);

// TypeBox / JSON Schema
import { buildJsonChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
const schema = buildJsonChannelConfigSchema(Type.Object({ ... }));
```

---

## 测试工具

### 关键导入路径

| 导入路径 | 用途 |
|----------|------|
| `openclaw/plugin-sdk/plugin-test-api` | 最小插件 API mock |
| `openclaw/plugin-sdk/channel-contract-testing` | Channel inbound/outbound 合约断言 |
| `openclaw/plugin-sdk/channel-test-helpers` | Account 生命周期、setup、status 合约套件 |
| `openclaw/plugin-sdk/plugin-test-contracts` | 插件注册合约检查 |
| `openclaw/plugin-sdk/plugin-test-runtime` | Runtime env、注册表 fixtures、烟雾测试 helpers |
| `openclaw/plugin-sdk/provider-test-contracts` | Provider runtime 合约 |
| `openclaw/plugin-sdk/test-env` | 环境修补、临时目录、mock 服务器 |
| `openclaw/plugin-sdk/test-fixtures` | CLI capture、模块缓存绕过、沙箱上下文 |

### Mock Helpers

```typescript
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { withEnv } from "openclaw/plugin-sdk/test-env";
import { createMockIncomingRequest } from "openclaw/plugin-sdk/test-fixtures";

// 最小 API mock
const api = createTestPluginApi();

// 环境变量修补
withEnv("MY_VAR", "test-value", () => { ... });

// 模块热加载（绕过 ESM 缓存）
import { importFreshModule } from "openclaw/plugin-sdk/test-fixtures";
```

### 测试命令

```bash
pnpm test -- <plugin-root>/                          # 作用域测试
pnpm test -- <plugin-root>/ -t "resolves account"    # 名称过滤
pnpm test -- src/plugins/contracts/                  # 合约测试
OPENCLAW_VITEST_MAX_WORKERS=1 pnpm test              # 内存压力
```

---

## 插件 Bundle 兼容

### 概述

OpenClaw 支持安装来自 **Codex**、**Claude** 和 **Cursor** 生态系统的 bundle，将其映射为原生功能。

### 检测优先级

1. 原生插件 (检查 `openclaw.plugin.json` 或 `package.json` 的 `openclaw.extensions`)
2. Bundle markers（如 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.cursor-plugin/plugin.json`）

### Bundle Markers by Ecosystem

| 生态系统 | Marker |
|----------|--------|
| Codex | `.codex-plugin/plugin.json` |
| Claude (manifest) | `.claude-plugin/plugin.json` |
| Claude (manifestless) | `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `.lsp.json`, `settings.json` |
| Cursor | `.cursor-plugin/plugin.json` |

### 功能映射

| Bundle 功能 | 映射方式 |
|-------------|----------|
| Skills/Commands | 作为普通 OpenClaw skills 加载 |
| MCP Tools | 合并到嵌入式 Pi `mcpServers`。命名: `serverName__toolName` (30+64 字符限制) |
| LSP Servers | 合并到嵌入式 Pi LSP 默认值 (仅 stdio 实际运行) |
| Settings | 作为嵌入式 Pi 默认值导入 (shell 键被消毒) |

### 不支持的功能

Claude: `agents`、`hooks.json` 自动化、`outputStyles` (检测到但未执行)
Cursor: `.cursor/agents`、`.cursor/hooks.json`、`.cursor/rules` (detect-only)

---

## CLI 管理命令

### 核心命令

```bash
openclaw plugins search "calendar"                      # 搜索 ClawHub
openclaw plugins install clawhub:<package>               # 从 ClawHub 安装
openclaw plugins install npm:<package>                   # 从 npm 安装
openclaw plugins install git:github.com/o/r@ref         # 从 Git 安装
openclaw plugins install ./local-plugin                  # 从本地路径安装
openclaw plugins install --link ./dev-plugin             # 本地 symlink (开发)
openclaw plugins enable <plugin-id>                      # 启用插件
openclaw plugins disable <plugin-id>                     # 禁用插件
openclaw plugins list                                    # 列出插件 (cold state)
openclaw plugins list --enabled --verbose                # 诊断重复
openclaw plugins inspect <id>                            # 检查 cold metadata
openclaw plugins inspect <id> --runtime --json           # 检查 live runtime 状态
openclaw plugins update <id>                             # 重新安装以修复依赖
openclaw plugins registry --refresh                      # 刷新注册表
openclaw gateway restart                                 # 重启 Gateway 使变更生效
```

### 配置策略

```yaml
plugins:
  enabled: true                   # 主开关
  allow: ["plugin-a", "plugin-b"] # 独占 allowlist
  deny: ["plugin-c"]              # 覆盖 allow 和 per-plugin enable
  load:
    paths: ["./local-plugins"]
  slots:
    memory: "active-memory"       # 强制执行独占类别
  entries:
    my-plugin:
      enabled: true
      config: { ... }
```

### Doctor

```bash
openclaw doctor                   # 验证所有配置
openclaw doctor --fix             # 自动修复：清除过期条目、迁移 legacy keys
```

---

## 源码结构与边界规则

### 关键目录

```
openclaw/
├── extensions/                  # Bundled 插件 (与第三方插件相同的边界)
│   ├── CLAUDE.md               # 插件边界规则
│   ├── openclaw-gotify/        # Gotify channel 插件
│   ├── anthropic/              # Anthropic provider 插件
│   ├── google/                 # Google provider 插件
│   └── ...
├── src/
│   ├── plugin-sdk/             # 所有插件 SDK 实现 (约 100+ 模块)
│   ├── channels/               # Channel 实现
│   ├── plugins/                # 插件加载器
│   ├── gateway/                # Gateway 协议
│   └── agents/                 # Agent 运行时
├── packages/
│   ├── plugin-sdk/             # 对外发布的 SDK 包 (re-export from src/plugin-sdk/)
│   └── plugin-package-contract/# 包合约验证
└── docs/
    └── plugins/                # 插件文档
```

### 关键边界规则

来自 `extensions/CLAUDE.md`：

1. **扩展生产代码应从 `openclaw/plugin-sdk/*` 导入**，而非从 `src/**`、`src/channels/**` 或另一个扩展的 `src/**` 导入
2. **不使用逃逸扩展包根目录的相对导入**
3. **保持插件元数据在 `openclaw.plugin.json` 和 `package.json` 中准确**，使发现和 setup 无需执行插件代码
4. **插件运行时依赖属于拥有它的插件包** —— 不要将其移到根 `package.json`
5. **核心保持插件无关** —— 当 manifest/registry/capability 合约可行时，核心代码中不应包含 bundled plugin id/defaults/policy
6. **插件仅通过 `openclaw/plugin-sdk/*`、manifest metadata、injected runtime helpers 和 documented barrels 进入核心**

### 导入约定

```typescript
// ✅ 正确
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

// ❌ 错误
import { ... } from "openclaw/plugin-sdk/compat";          // Deprecated barrel
import { ... } from "openclaw/plugin-sdk/infra-runtime";   // Deprecated barrel
import { ... } from "openclaw/extension-api";              // Deprecated compat surface
import { ... } from "../../src/agents";                    // No core internals
import { ... } from "openclaw/plugin-sdk/my-plugin";       // No self-imports
```

---

## SDK 迁移指南

### 已弃用的 Import Surface

| 旧路径 | 状态 | 替代 |
|--------|------|------|
| `openclaw/plugin-sdk/compat` | Deprecated | 各 focused subpath |
| `openclaw/plugin-sdk/infra-runtime` | Deprecated | `runtime-store`, `command-auth` 等 |
| `openclaw/plugin-sdk/config-runtime` | Deprecated | `config-contracts`, `runtime-config-snapshot` 等 |
| `openclaw/extension-api` | Deprecated | `api.runtime.agent.*` |

### 关键破坏性变更

1. **Broad imports → Narrow subpaths**: 每个 import path 是自包含模块
2. **`registerEmbeddedExtensionFactory`** → `registerAgentToolResultMiddleware` + manifest `contracts.agentToolResultMiddleware`
3. **`loadConfig()` / `writeConfigFile()`** → `config.current()` / `mutateConfigFile()` with explicit `afterWrite` policy
4. **Talk RPC migration**: `talk.realtime.*` → `talk.session.*` / `talk.client.*`
5. **Approval handlers**: `handler.loadRuntime` → `approvalCapability.nativeRuntime`
6. **Channel route helpers**: `channelRouteIdentityKey` → `channelRouteDedupeKey`
7. **Memory plugin**: 三个独立调用 → 单一 `registerMemoryCapability(pluginId, {...})`
8. **Thinking policy**: 三个独立 hooks → 单一 `resolveThinkingProfile(ctx)`

### 兼容性策略

变更遵循严格顺序：添加新合约 → 通过兼容适配器保留旧行为 → 发出命名旧路径和替代的诊断/警告 → 测试两条路径 → 文档化迁移 → 仅在 major release 后移除。

---

## 标准文件布局

### Channel Plugin

```
my-channel/
├── package.json                # openclaw metadata
├── openclaw.plugin.json        # Manifest (id, channels, configSchema, channelConfigs, activation)
├── index.ts                    # defineChannelPluginEntry (完整入口)
├── setup-entry.ts              # defineSetupPluginEntry (轻量 setup 入口)
└── src/
    ├── channel.ts              # createChatChannelPlugin
    ├── channel.test.ts
    ├── config.ts               # Zod schemas + config resolution
    ├── runtime.ts              # PluginRuntime store singleton
    ├── outbound.ts             # Outbound message adapter
    ├── dm-scope.ts             # DM scope resolution
    ├── types.ts                # Type definitions
    └── setup.ts                # Setup wizard helpers
```

### Provider Plugin

```
my-provider/
├── package.json
├── openclaw.plugin.json
├── index.ts                    # definePluginEntry + registerProvider
└── src/
    ├── provider.test.ts
    └── usage.ts                # 可选: 用量追踪
```

### 通用 Tool/Hook Plugin

```
my-tool/
├── package.json
├── openclaw.plugin.json
├── index.ts                    # definePluginEntry
├── api.ts                      # Public exports (对外合约)
├── runtime-api.ts              # Internal runtime exports
└── src/
    └── tool.test.ts
```
