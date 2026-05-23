# Feishu plugin-sdk 对照表与 WeCom 映射状态

> 统计来源：`research/openclaw/extensions/feishu` 中 `from "openclaw/plugin-sdk/..."` 引用（约 45+ 子路径）。  
> 企业微信业务 API 仍以 `@wecom/aibot-node-sdk` + Agent HTTP 为准，下表仅描述 **OpenClaw 通道/SDK 抽象层**。

## 图例

| 状态 | 含义 |
|------|------|
| ✅ | WeCom 已直接使用 SDK 或 message-sdk 封装 |
| 🔶 | 通过 `openclaw-compat` / message-sdk 动态探测 + fallback |
| 📝 | 自研实现，计划对齐 SDK |
| ➖ | 不适用（企微无对等能力） |

## SDK 子路径对照

| SDK 子路径 | 主要能力 | Feishu 用途 | WeCom 状态 |
|------------|----------|-------------|------------|
| channel-entry-contract | `defineBundledChannelEntry` | 捆绑入口、懒加载 tools | 📝 手写 `index.ts` register |
| channel-core | `createChatChannelPlugin` | 通道插件工厂 | 📝 手写 `channel.ts`；见 `channel-factory.ts` |
| channel-contract | 消息动作契约 | send/edit/react | 🔶 类型 import |
| channel-message | `createChannelMessageReplyPipeline` | 统一回复管线 | 🔶 `reply-pipeline.ts` |
| channel-streaming | 流式草稿行 | 工具进度 | ➖ |
| channel-pairing | 配对控制器 | allowFrom | 🔶 pairing + notify |
| channel-policy | 策略告警 | DM/群策略 | 🔶 `buildAccountScopedDmSecurityPolicy` |
| channel-config-helpers | 混合配置适配 | 多账号 | 📝 `accounts.ts` |
| channel-config-writes | 配置写回 | 写配置路径 | ➖ |
| channel-ingress-runtime | 入站策略 | policy | 📝 |
| channel-inbound / channel-inbound-debounce | 入站封装、防抖 | 入站 | 📝 monitor |
| channel-send-result | 出站结果 | outbound | 📝 |
| channel-feedback | `logTypingFailure` | 打字失败 | ➖ |
| channel-status | probe、运行时状态 | 状态快照 | 🔶 `probe.ts` |
| channel-secret-basic-runtime | secret 注册表 | env/file secret | 📝 |
| outbound-runtime | 出站委托 | outbound | 📝 |
| reply-payload | 出站拆分 | 文本/媒体顺序 | 🔶 message-sdk `pipeline/reply-parts` |
| interactive-runtime | 交互卡片呈现 | 飞书卡片 | ➖ 企微模板卡片自研 |
| directory-runtime | 通讯录 Live | directory | 📝 桩实现 |
| conversation-runtime | 会话绑定 | thread | ➖ |
| routing | 路由、Agent 解析 | 路由 | 📝 core 路由 |
| session-store-runtime | 会话存储 | session | 📝 |
| persistent-dedupe | 磁盘+内存去重 | 重启不丢 | ✅ message-sdk + webhook `dedup.ts` |
| webhook-ingress | body 限流、守卫 | Webhook | ✅ message-sdk `http/body-limit` |
| webhook-request-guards | 请求守卫 | Webhook | 🔶 |
| security-runtime | 路径沙箱 | 本地媒体 | ✅ message-sdk `media/path-guard` |
| media-runtime | 媒体落盘、ffmpeg | 媒体 | 🔶 compat + message-sdk |
| media-store / media-mime | MIME、存储 | 媒体 | 🔶 message-sdk |
| temp-path | 临时目录 | tmp | 📝 |
| response-limit-runtime | 下载限流 | 响应体 | ✅ message-sdk |
| ssrf-runtime | `fetchWithSsrFGuard` | URL 安全 | ✅ message-sdk `http/safe-fetch` |
| text-chunking | Markdown 分块 | 出站 | 📝 `TEXT_CHUNK_LIMIT` |
| markdown-table-runtime | 表格模式 | 表格 | ➖ |
| agent-runtime | 推理格式化 | Agent | ➖ |
| agent-media-payload | Agent 媒体载荷 | 媒体 | ➖ |
| approval-auth-runtime | 审批授权 | 审批 | ➖ |
| account-helpers | 账号快照 | status | 📝 |
| account-id | `normalizeAccountId` | 账号 ID | ✅ |
| account-resolution | 账号解析 | policy | 📝 |
| allow-from | 白名单格式化 | allowFrom | 🔶 compat |
| command-detection | 控制命令 | 命令 | 📝 |
| command-primitives-runtime | 同会话串行 | 串行 | 📝 |
| context-visibility-runtime | 上下文过滤 | 可见性 | ➖ |
| error-runtime | 统一错误文案 | 错误 | 🔶 message-sdk |
| extension-shared | client 扩展 | SDK client | ➖ |
| lazy-runtime | 懒加载 runtime | 冷启动 | 📝 |
| status-helpers | 状态适配器 | status | 📝 |
| setup | 向导、写配置 | onboarding | ✅ `onboarding.ts` |
| secret-input | 密钥 schema | schema | 📝 |
| runtime / runtime-group-policy | 运行时 | 群策略 | 📝 |
| config-contracts / config-mutation | 配置变更 | 配置 | 📝 |
| json-store | JSON 持久化 | 状态文件 | 🔶 dedupe 文件 |
| core | `ChannelPlugin` 类型 | 基础 | ✅ |
| plugin-test-* | 测试基建 | 62 个测试 | 📝 wecom 13 文件 |

## message-sdk 承接（平台无关）

| 模块 | 路径 | 说明 |
|------|------|------|
| persistent-dedupe | `dedup/persistent-dedupe.ts` | 优先 `openclaw/plugin-sdk`，本地 fallback |
| path-guard | `media/path-guard.ts` | 对齐 security-runtime |
| body-limit | `http/body-limit.ts` | 对齐 webhook-ingress |
| safe-fetch | `http/safe-fetch.ts` | 对齐 ssrf-runtime |
| reply-parts | `pipeline/reply-parts.ts` | 对齐 reply-payload 拆分 |
| format-error | `util/format-error.ts` | 对齐 error-runtime |

## WeCom 关键文件

| 用途 | 路径 |
|------|------|
| 通道插件 | `extensions/wecom/src/channel.ts` |
| SDK 兼容层 | `extensions/wecom/src/openclaw-compat.ts` |
| 回复管线封装 | `extensions/wecom/src/reply-pipeline.ts` |
| 工厂探测（迁移预留） | `extensions/wecom/src/channel-factory.ts` |
| Webhook 去重 | `extensions/wecom/src/webhook/dedup.ts` |
| 账号探测 | `extensions/wecom/src/probe.ts` |
| message-sdk 桥接 | `extensions/message-sdk/src/bridge/` |

## 明确不借鉴

- 飞书 Doc/Wiki/Bitable 工具链 → WeCom 继续 MCP + Skills  
- 飞书 `interactive-runtime` → 企微模板卡片 JSON + 自研 parser  
- 飞书 thread binding / comment dispatcher → 按企微产品能力再定  
