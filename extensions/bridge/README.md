# OpenClaw Bridge

<!-- README_STANDARD_START -->

> 统一阅读顺序：组件定位 → 架构 → 流程 → 边界 → 安装 → 配置 → 运维 → 深入阅读。
> 本区块以 npm 可稳定渲染的 text 图为主；适用时，更深入的 Mermaid 图保留在仓库 `doc/` 设计资料中。

[简体中文](./README.md)

## 1. 组件定位

跨渠道补充上下文并镜像消息事件。组件类型：**Hook / 消息观测桥**。

| 项目 | 内容 |
|---|---|
| npm 包 | `@partme.ai/openclaw-bridge` |
| 当前版本 | `2026.7.1` |
| 插件 ID | `bridge` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| 源码目录 | `extensions/bridge` |

## 2. 一眼看懂

```text
[OpenClaw 收发消息 Hook]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ OpenClaw Gateway 内: bridge
│ 1. 识别来源 Channel 与上下文预设
│ 2. 规范化为 UnifiedMessage
│ 3. 注入上下文或投递到 MQ
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[上下文约束与审计消息]
```

## 3. 架构与核心流程

该组件把“协议/平台差异”限制在自身边界内，对 OpenClaw 暴露稳定的插件、Channel、Hook、Tool 或 Service 契约。

```text
OpenClaw 收发消息 Hook
  │
  ▼
识别来源 Channel 与上下文预设
  │
  ▼
规范化为 UnifiedMessage
  │
  ▼
注入上下文或投递到 MQ
  │
  ▼
上下文约束与审计消息

异常路径: 任一步失败：记录可诊断错误并按组件策略重试、拒绝或降级
```

## 4. 能力与边界

| 能力 | 说明 |
|---|---|
| 负责 | 跨渠道补充上下文并镜像消息事件 |
| 不负责 | 不替代原始 Channel，也不接管平台鉴权 |
| 输入 | OpenClaw 收发消息 Hook |
| 输出 | 上下文约束与审计消息 |
| 失败原则 | 默认失败应可观测；鉴权、边界校验和持久化失败不得伪装成功 |

## 5. 快速开始

```bash
openclaw plugins install "@partme.ai/openclaw-bridge@2026.7.1"
```

安装后先按最小权限配置，再启动 Gateway；生产环境应在隔离配置目录中完成连通性、权限和失败恢复验证。

## 6. 配置入口

| 配置层 | 路径 |
|---|---|
| 插件配置 | `plugins.entries.bridge.config` |
| Channel 配置 | 不适用 |
| 配置 Schema | `extensions/bridge/openclaw.plugin.json` |

配置字段、环境变量与完整示例继续保留在下方原有详细说明中。

## 7. 运维、安全与故障定位

- 先确认 OpenClaw 版本、插件版本、manifest ID 与配置键一致。
- 凭据使用环境变量或 SecretRef，不写入日志、仓库和示例明文。
- 通过 Gateway 日志、插件健康状态及外部依赖状态分层定位问题。
- 升级前备份状态数据；涉及游标、队列或索引时，必须验证重启恢复与重复投递语义。

## 8. 验证与深入阅读

```bash
pnpm --filter "@partme.ai/openclaw-bridge" typecheck
pnpm --filter "@partme.ai/openclaw-bridge" test
pnpm --filter "@partme.ai/openclaw-bridge" build
```

- [插件总体架构](../../doc/OpenClaw-Plugins-Architecture_CN.md)
- [统一插件结构规范](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. 原有详细说明

以下内容保留该组件原有的配置表、协议细节、示例和故障排查资料。

<!-- README_STANDARD_END -->


`@partme.ai/openclaw-bridge` 是面向 OpenClaw 2026.7.1 的跨渠道上下文与消息观测桥。它不替代任何 IM 或 MQ Channel 插件，主要提供两项能力：

- 通过官方 `before_prompt_build` Hook，为已配置的 IM 渠道追加平台交互约束。
- 通过官方 `message_received`、`message_sent` Hook 观察真实收发结果，再经公共 channel outbound adapter 将 `UnifiedMessage` 镜像到 MQ。

字符图先展示 Hook 主链与后台镜像的边界；下方 Mermaid 保留同一架构的可渲染视图：

```text
Source Channel
      │
      ├── before_prompt_build ──▶ platform context ──▶ Agent Prompt
      │
      ├── message_received ─────┐
      │                         │
      └── actual send ──▶ message_sent(success=true)
                                │
                                ▼
                       UnifiedMessage normalize
                                │
                                ▼
                     bounded in-memory queue
                       (ordered per traceId)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             adapter confirmed        timeout / retry
                                             │
                                             ▼
                                    exhausted: log failure
                                │
                                ▼
                     Channel Outbound Adapter
                                │
                                ▼
                    MQTT / RabbitMQ / Redis Stream /
                         RocketMQ / STOMP
```

```mermaid
flowchart LR
    SRC["来源 Channel"] -->|"入站已进入 OpenClaw"| IN["message_received"]
    SRC --> AGENT["OpenClaw Agent"]
    AGENT --> TX["来源 Channel 真实发送"]
    TX -->|"成功 / 失败已确定"| OUT["message_sent"]

    IN --> NORMALIZE["归一化 UnifiedMessage"]
    OUT --> CHECK{"发送成功且<br/>不是审计回环？"}
    CHECK -->|"否"| SKIP["跳过并记录原因"]
    CHECK -->|"是"| NORMALIZE
    NORMALIZE --> QUEUE["有界内存队列<br/>同会话保序"]
    QUEUE --> ADAPTER["公共 Outbound Adapter"]
    ADAPTER --> MQ["MQ inbound / outbound Topic"]

    classDef hook fill:#e3f2fd,stroke:#1565c0,color:#0d315c
    classDef bridge fill:#e8f5e9,stroke:#2e7d32,color:#123d17
    classDef external fill:#fff3e0,stroke:#ef6c00,color:#4e2600
    class IN,OUT hook
    class NORMALIZE,CHECK,QUEUE,ADAPTER bridge
    class SRC,TX,MQ external
```

`message_sent` 是传输完成事件：Bridge 只镜像 `success=true` 的真实出站结果。仓库内使用 `message-sdk` 自定义 reply pipeline 的 Wire/MQ 通道，会在协议 publish 成功或失败后补齐同一官方 Hook；Hook 观察者失败不会反向改变已经完成的协议发送。`reply_payload_sending` 属于发送前的回复处理阶段，不能证明外部平台已经接受消息，因此不再用于 Bridge 出站审计。

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-bridge
```

Bridge 的清单 ID 是 `bridge`，配置应写入 `plugins.entries.bridge.config`。

## 配置示例

```json
{
  "plugins": {
    "entries": {
      "bridge": {
        "enabled": true,
        "config": {
          "channels": {
            "discord": {
              "enabled": true,
              "contextInjection": true,
              "forwardToMq": true,
              "includeMediaUrls": false,
              "mqChannel": "rabbitmq",
              "mqAccountId": "default",
              "topicPrefix": "openclaw/bridge/discord"
            },
            "wecom": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "mqtt"
            }
          },
          "delivery": {
            "maxAttempts": 3,
            "retryDelayMs": 250,
            "publishTimeoutMs": 5000,
            "maxPayloadBytes": 1048576,
            "maxInFlight": 4,
            "maxBufferedMessages": 1024,
            "shutdownTimeoutMs": 10000
          }
        }
      }
    }
  }
}
```

只有 `channels` 中显式声明的来源渠道会被处理。未知来源渠道或不支持的 MQ ID 会在注册时失败；受支持但未安装或未就绪的 adapter 会在后台投递时明确失败并执行有界重试，不会静默回退后误投递。

入站媒体消息即使没有正文也会生成 `UnifiedMessage`。`includeMediaUrls` 默认关闭，此时只保留媒体数量、类型和 MIME，避免把带签名的对象存储地址扩散到 MQ。单个信封最多保留 16 个媒体条目，超出时通过原始 `mediaCount` 与 `mediaTruncated=true` 明示截断。显式开启后仅接受不含 URL 用户名/密码的 HTTP(S) 地址；查询参数仍应按敏感数据管理。OpenClaw 2026.7.1 的出站 `message_sent` 不携带媒体元数据，因此该能力仅覆盖入站事件。

## MQ 渠道

支持以下 outbound adapter ID：

- `mqtt`
- `mqtt-ws`（兼容旧别名 `web-mqtt`）
- `rabbitmq`
- `redis-stream`
- `rocketmq`
- `stomp`（兼容旧别名 `web-stomp`）
- `stomp-tcp`

MQ 插件必须独立安装并配置。MQTT、RabbitMQ、Redis Stream、RocketMQ 使用 `openclaw-direct-topic:v1:` 显式直达契约，不会把 OpenClaw 普通 durable reply 的 `deliveryQueueId` 误判成 Topic。STOMP 使用 `/topic/` destination。

默认 Topic：

- `openclaw/bridge/{sourceChannel}/inbound`
- `openclaw/bridge/{sourceChannel}/outbound`

可用 `topicPrefix` 覆盖前缀。

## 渠道范围

静态能力表包含 27 个渠道：20 个 OpenClaw 2026.7.1 stock 渠道、当前仓库的 `wecom`、`openclaw-weixin`、`wechat-ipad`、`wecom-kf`、`douyin`、`mqtt`，以及外部 `dingtalk-connector`。其中飞书与 QQ 的当前 stock ID 分别是 `feishu`、`qqbot`；旧文档中的 `openclaw-lark` 已不再使用。

Bridge 只对实际安装、运行、在配置中启用且正确发出官方消息 Hook 的渠道生效。静态能力表表示“有上下文预设和配置识别”，不代表 27 个渠道均已安装或完成环境验收。当前安装态 E2E 使用 MQTT 验证入站、Agent 回复、`message_sent`、双向审计 Topic 与防回环；其他渠道仍须逐个做真实账号/租户验收。

```text
静态渠道元数据 → 2026.7.1 Hook 契约 → MQTT tarball E2E → 真实 IM × MQ 验收 → 生产准入
     已覆盖              已对齐               已自动验证            尚需逐组合执行
```

```mermaid
flowchart LR
    META["静态渠道元数据"] --> CONTRACT["OpenClaw 2026.7.1<br/>Hook 契约"]
    CONTRACT --> E2E["MQTT tarball E2E"]
    E2E --> ENV["真实 IM × MQ<br/>环境验收"]
    ENV --> PROD["生产准入"]
```

## 投递语义与边界

- Hook 只完成校验、归一化和非阻塞入队，不等待 Broker 网络请求，因此 MQ 故障不会把 OpenClaw 主消息链拖进重试延迟。
- 后台 Service 用 `maxInFlight` 限制并发、用 `maxBufferedMessages` 限制等待队列；不同 `traceId` 可并发，同一会话仍按入队顺序串行，避免重试时发生回复反超。队列满时明确记录被丢弃消息的 ID、渠道和方向。
- 单条后台任务有界重试，每次重试复用同一个 `deliveryQueueId`。
- 单条 JSON 载荷受 `maxPayloadBytes` 限制。
- Gateway 停止时先排空队列；超过 `shutdownTimeoutMs` 后中断退避、丢弃未开始任务并报告结果未知的在途数量。
- 进程崩溃会丢失尚未完成的内存任务，因此 Bridge 本身是 best-effort/at-least-once 观测镜像，不提供持久 Outbox。
- 需要跨重启恢复、DLQ、审计和运维回放时，应使用 `@partme.ai/openclaw-router` 的持久投递链路。
- Broker 超时后的实际结果可能未知，下游应按 `messageId`/`deliveryQueueId` 实现幂等。
- 来源 Channel 与目标 MQ adapter 的错误在进入 Gateway 日志前会脱敏 URL 用户信息、Authorization、Token/Secret，并清理控制字符、限制诊断长度。

```mermaid
stateDiagram-v2
    [*] --> Hook接收
    Hook接收 --> 已入队: 队列有容量
    Hook接收 --> 明确丢弃: 队列已满
    已入队 --> 投递中: 并发额度可用
    投递中 --> 已完成: Adapter确认
    投递中 --> 等待重试: 失败且未达上限
    等待重试 --> 投递中: 有界退避
    投递中 --> 失败记录: 达到重试上限
    已入队 --> 停机排空: Gateway停止
    停机排空 --> 已完成: 超时前完成
    停机排空 --> 明确丢弃: 超过停机上限
```

## 开发验证

```bash
pnpm test
pnpm typecheck
pnpm build
npm pack --dry-run
```

## License

MIT
