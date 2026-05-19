# openclaw-plugins — 企业级架构设计

## 1. 概述

openclaw-plugins 由 **PartMe.AI 团队** 研发与二次开发，包含 29 个插件。其目标是以 OpenClaw 智能体为核心枢纽，打通 IM 渠道、消息队列、知识库、长期记忆，形成多平台信息流闭环。

### 1.1 已有能力

```
                     OpenClaw Gateway
                           │
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
    ▼                       ▼                       ▼
┌──────────┐         ┌──────────┐           ┌──────────┐
│ IM 渠道   │         │ 消息队列  │           │ 能力增强 │
│ 7 个插件  │         │ 7 个插件  │           │ 3 个插件 │
└──────────┘         └──────────┘           └──────────┘
```

### 1.2 缺失与方案

| 缺失 | 问题 | 方案 |
|------|------|------|
| 跨渠道路由 | 企微消息无法转发到MQ，MQ消息无法回复到IM | openclaw-router |
| 知识库开箱即用 | knowledge 插件需要 Agent 主动调用工具 | router 自动注入RAG |
| 长期记忆 | 每次对话从零开始 | openclaw-memory (L0→L3) |
| 消息审计 | 无统一记录 | router 审计日志 |
| 客服映射 | 不同客服映射到不同智能体 | wecom-kf 多Agent绑定 |

---

## 2. 五层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — 业务应用层                                       │
│  SCRM后台 / 数据看板 / 人工客服台                            │
│  通过订阅 MQ 主题实现实时对话数据消费                         │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 4 — 消息路由层 (openclaw-router)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 规则引擎  │ │ 转发引擎  │ │ 审计日志  │ │ 知识/记忆注入 │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 3 — 智能体层                                         │
│  Agent-1 (运维)  Agent-2 (销售)  Agent-3 (客服) ...        │
│  每个Agent可绑定: 记忆 + 知识库 + 工具集                     │
│  路由通过 bindings[].match → agentId                       │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 2 — 能力增强层                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ knowledge    │ │ memory       │ │ tracing              │ │
│  │ (RAG引擎)    │ │ (L0→L3记忆)  │ │ (分布式追踪)         │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 1 — 通道层（零代码修改）                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │ IM渠道 (7)          │  │ MQ渠道 (7)                   │  │
│  │ wecom wechat qqbot  │  │ mqtt rabbitmq redis-stream   │  │
│  │ dingtalk lark       │  │ stomp web-stomp rocketmq     │  │
│  │ wecom-kf wechat-ipad│  │ web-mqtt cluster             │  │
│  └─────────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 3. 核心设计原则：不修改任何渠道插件

OpenClaw SDK 提供了关键能力：`api.on("agent_end", ctx)` 对**所有渠道**触发。

这意味着 **openclaw-router 作为独立插件，监听所有渠道的消息事件，不需要渠道插件配合**。

```
wecom 插件:                         openclaw-router 插件:
  register(api) {                     register(api) {
    api.registerChannel({...})          api.on("agent_end", (event, ctx) => {
    // 只负责格式转换                       // ctx.channelId 告诉你来自哪个渠道
  }                                      // 现在: 转发、回复、记录
                                       });
                                     }
                                   }
```

---

## 4. 三流模型

### 4.1 IM 入站流（用户 → Agent → MQ 审计）

```
客户 @企微: "我的订单在哪"
    │
    ▼
[wecom] → OpenClaw 消息
    │
    ▼
[Agent "sales"] → 回复
    │
    ├──→ [wecom] 回复给用户 ← 正常路径
    │
    └──→ [router] agent_end 事件
            │
            ├─ 匹配规则: channel=wecom → forward-copy:inbound
            │   └→ [mqtt] publish "openclaw/audit/wecom/inbound"
            │
            └─ 匹配规则: channel=wecom → forward-copy:outbound
                └→ [mqtt] publish "openclaw/audit/wecom/outbound"
                    │
                    ▼
                [业务系统订阅] → SCRM 看板看到完整对话记录
```

### 4.2 MQ 入站流（业务系统 → Agent → IM 回复）

```
[监控系统] 检测到 CPU > 90%
    │
    ▼
MQTT: "openclaw/agent/ops/inbound"
    "⚠️ 生产服务器CPU使用率90%，建议立即检查"
    │
    ▼
[mqtt] → OpenClaw 消息
    │
    ▼
[Agent "ops"] → 分析: "可能是内存泄漏，建议执行: top -o mem"
    │
    ├──→ [mqtt] 原路径回复 ← 正常路径
    │
    └──→ [router] agent_end 事件
            │
            └─ 匹配: channel=mqtt + topic=openclaw/agent/ops/inbound
                → reply-via:wecom → user:admin_ops
                    │
                    ▼
                运维工程师在企微收到告警通知
```

### 4.3 增强流（每次对话自动注入）

```
任何消息到达 Agent
    │
    ▼
[router] before_prompt_build 事件
    │
    ├─ [knowledge] 自动搜索 → "订单API: GET /api/orders/{id}…"
    │   └→ 注入系统上下文
    │
    └─ [memory] 自动召回 → "用户上次问过退换货政策，对配送不满"
        └→ 注入系统上下文
    │
    ▼
[Agent] 无需调用任何工具，自动获得知识+记忆上下⽂
```

---

## 5. 插件设计

### 5.1 openclaw-router — 消息路由引擎（165 行核心代码）

**类型**：非通道插件（非 `api.registerChannel`，而是 `api.on` 监听事件）

**路由规则配置**：

```json
{
  "router": {
    "enabled": true,
    "rules": [
      {
        "id": "im-audit-log",
        "match": { "channels": ["wecom","wechat","dingtalk"], "direction": "both" },
        "actions": [
          { "type": "forward", "target": "mqtt", "topic": "openclaw/audit/{{channel}}/{{direction}}" }
        ]
      },
      {
        "id": "scrm-customer-reply",
        "match": { "channels": ["rabbitmq"], "topic": "openclaw/scrm/reply" },
        "actions": [
          { "type": "reply-via", "target": "wecom-kf", "to": "{{metadata.originalUserId}}" }
        ]
      },
      {
        "id": "mq-alert-to-im",
        "match": { "channels": ["mqtt"], "topic": "openclaw/agent/ops/inbound" },
        "actions": [
          { "type": "reply-via", "target": "wecom", "accountId": "ops", "to": "user:admin_ops" }
        ]
      }
    ],
    "knowledge": { "autoInject": true, "maxResults": 5 },
    "memory": { "autoInject": true, "maxResults": 5 },
    "audit": { "enabled": true }
  }
}
```

**规则语义**：

| 字段 | 说明 |
|------|------|
| `match.channels` | 匹配的渠道列表（空=全部） |
| `match.direction` | `inbound`（用户→Agent）/ `outbound`（Agent回复）/ `both` |
| `match.topic` | MQ 话题匹配（用于 MQ 渠道） |
| `match.accountId` | 特定账号匹配 |
| `action.type` | `forward`（转发副本到MQ）/ `reply-via`（回复到另一个IM渠道） |
| `action.target` | 目标渠道 ID |
| `action.topic` | MQ 主题（支持 `{{variable}}` 模板变量） |

### 5.2 openclaw-memory — 多级长期记忆（303 行核心代码）

**架构**：
```
对话开始
  → before_prompt_build: 关键词搜索相关记忆 → 注入上下文

对话结束
  → agent_end: 捕获对话 → L0 JSONL 录制
  → Pipeline 调度: 每N轮对话触发L1提取
     ├── L1: 提取关键词，保存结构化记忆
     ├── L2: 场景归纳（规划中）
     └── L3: 用户画像（规划中）
```

**与 memory-tdai 参考实现的差异**：

| memory-tdai | openclaw-memory |
|-------------|-----------------|
| node-llama-cpp 做 embedding | 远程 API（可选）或纯关键词 |
| sqlite-vec 硬依赖 | JSONL 主存储 |
| L2/L3 场景+画像 | 先做 L1 关键词，L2/L3 后续 |
| 内置 embedded agent | 复用 OpenClaw 已配置的 LLM |

### 5.3 wecom-kf — 多客服映射

不同微信客服账号映射到不同风格、不同知识库的智能体：

```
客服账号 "售前-热情型" → Agent "agent-presale-warm"
客服账号 "售后-耐心型" → Agent "agent-aftersale-patient"
客服账号 "技术-专业型" → Agent "agent-tech-expert"

每个 Agent 可以有不同的：
  - 系统提示词 (personality)
  - 知识库 (RAG scope)
  - 长期记忆 (per-user conversation memory)
  - 工具集 (tools)
```

### 5.4 knowledge — RAG 自动注入

knowledge 插件已存在，提供 RAG 检索能力。router 在其上增加自动注入层：

用户消息 → `before_prompt_build` → router 调用 `knowledge_search` 工具 → 将结果注入系统上下文。Agent 不需要主动调用搜索工具。

---

## 6. 实施路径

### Phase 1: 基础（当前）✅

| 项目 | 状态 |
|------|------|
| openclaw-router 核心（165行） | ✅ |
| openclaw-memory 核心（303行） | ✅ |
| 企业级架构文档 | ✅ |
| 29 个插件迁移+标准化 | ✅ |

### Phase 2: 深度集成（2-3周）

| 项目 | 优先级 |
|------|--------|
| IM→MQ 转发生产验证 | P0 |
| MQ→IM 回复生产验证 | P0 |
| memory L2 场景提取 | P1 |
| knowledge 自动注入验证 | P1 |
| 审计日志 traceId 追踪 | P2 |

### Phase 3: 企业级平台（持续）

| 项目 |
|------|
| 人工客服转接（wecom-kf 增强） |
| 多轮会话管理（基于 memory） |
| MQ 高可用（基于 nacos 集群发现） |
| 业务系统客户端 SDK |
| Prometheus 消息吞吐量监控 |

---

## 7. 关键设计决策

### 7.1 为什么不做"修改渠道插件"而是"外部监听"

OpenClaw 的 `agent_end` 事件对所有渠道触发。外部 router 可以观察一切。

- 不修改渠道代码 → 零维护负担
- 新 IM 渠道未来添加后自动获得路由能力
- 路由规则纯配置 → 改规则不需要重新部署

### 7.2 转发 vs 双 Agent 处理

选择转发副本（不是双 Agent 处理）。

- 转发是轻量操作，只推送消息文本到 MQ
- 业务系统接收原始对话数据，独立处理
- 不额外产生 LLM 成本

### 7.3 MQ→IM 回复时，谁说话

原始 Agent 处理 MQ 消息，router 转发回复。

- 所有 Agent 统一管理
- Agent 有完整会话上下文
- 业务系统可通过 metadata 指导回复方向

### 7.4 统一消息格式

轻量 SDK（`@partme.ai/message-sdk`），插件可选使用：

```typescript
interface UnifiedMessage {
  sessionId: string;
  traceId: string;
  source: { channel: string; accountId: string; userId: string; chatType: "direct" | "group" };
  target?: { channels: string[]; routingRule?: string };
  contentType: "text" | "image" | "file" | "voice" | "video" | "mixed";
  text?: string;
  media: Array<{ url: string; type: string; name?: string }>;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

---

## 8. 验证

```bash
openclaw gateway --port 18789
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/openclaw-mqtt
openclaw plugins install @partme.ai/openclaw-router
openclaw plugins install @partme.ai/openclaw-memory

# 配置跨渠道路由规则（如上所示）
# 测试: 企微发消息 → MQTT 收到副本 → 业务系统处理 → MQTT 回复 → 企微收到
```

## 关于 openclaw-plugins

本文档属于 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 29 个插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施。

> 📧 联系我们：partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)
