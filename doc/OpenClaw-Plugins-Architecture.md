# openclaw-plugins — Enterprise Architecture

## 1. Overview

openclaw-plugins is an enterprise OpenClaw plugin collection developed and further developed by the **PartMe.AI team**, containing 29 plugins. Its goal is to use OpenClaw Agents as the hub, connecting IM channels, message queues, knowledge bases, and long-term memory into a closed-loop multi-platform information flow.

### 1.1 What We Have

```
                     OpenClaw Gateway
                           │
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
    ▼                       ▼                       ▼
┌──────────┐         ┌──────────┐           ┌──────────┐
│ IM 渠道   │         │ 消息队列  │           │ 能力增强 │
│ wecom     │         │ mqtt     │           │ knowledge│
│ wechat    │         │ rabbitmq │           │ memory   │
│ dingtalk  │         │ redis    │           │ router   │
│ qqbot     │         │ rocketmq │           │          │
│ lark      │         │ stomp    │           │          │
│ wecom-kf  │         │ web-mqtt │           │          │
│ wechat-   │         │ web-stomp│           │          │
│   ipad    │         │ cluster  │           │          │
└──────────┘         └──────────┘           └──────────┘
```

### 1.2 What We Need

| Gap | Problem | Solution |
|-----|---------|----------|
| **Cross-channel routing** | WeCom messages cannot auto-forward to MQ; MQ messages cannot reply to IM | openclaw-router |
| **Knowledge out-of-box** | knowledge plugin exists but requires Agent to actively call tools | Router auto-injects RAG context |
| **Long-term memory** | Each conversation starts from zero | openclaw-memory (L0→L3) |
| **Message audit** | No unified message record | Router audit logging |
| **Agent mapping** | Customer service agents map to different AI agents | wecom-kf multi-agent binding |

---

## 2. Architecture Design

### 2.1 Five-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — Business Applications                            │
│  SCRM dashboard / Live chat console / Data analytics        │
│  Subscribe to MQ topics for real-time conversation feed     │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 4 — Message Router (openclaw-router)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Rule     │ │ Forward  │ │ Audit    │ │ Knowledge/   │  │
│  │ Engine   │ │ Engine   │ │ Logger   │ │ Memory Inj.  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 3 — OpenClaw Agents                                  │
│  Agent-1 (ops)  Agent-2 (sales)  Agent-3 (support) ...     │
│  Each agent can bind: memory + knowledge + toolset          │
│  Routing: bindings[].match → agentId                        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 2 — Capability Enhancement                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ openclaw-    │ │ openclaw-    │ │ openclaw-            │ │
│  │ knowledge    │ │ memory       │ │ tracing              │ │
│  │ (RAG engine) │ │ (L0→L3)     │ │ (distributed trace)  │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Layer 1 — Channel Layer (NO modification needed)           │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │ IM Channels (7)     │  │ MQ Channels (7)              │  │
│  │ wecom wechat        │  │ mqtt web-mqtt stomp          │  │
│  │ dingtalk qqbot lark │  │ web-stomp rabbitmq redis     │  │
│  │ wecom-kf wechat-ipad│  │ rocketmq cluster             │  │
│  └─────────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Core Design Principle: Don't Modify Channels

The key insight is simple:

> **OpenClaw's `api.on("agent_end", ctx)` fires for ALL channels. A non-channel plugin can listen to every channel's message flow.**

This means we never modify wecom, dingtalk, or any channel plugin code. The router sits outside, watching all events.

```
wecom plugin:                      openclaw-router:
  register(api) {                    register(api) {
    api.registerChannel({...});        api.on("agent_end", (event, ctx) => {
    // only handles message              // ctx.channelId tells which channel
    // format conversion                 // now decide: forward? reply-via?
  }                                    });
                                      }
                                    }
```

### 2.3 Three Message Flows

**Flow 1: IM Inbound (User → Agent → MQ audit)**

```
Customer @WeCom bot: "我的订单在哪"
    │
    ▼
[wecom plugin] → format conversion → OpenClaw message
    │
    ▼
[Agent "sales"] → processes → generates reply
    │
    ├──→ [wecom plugin] → send reply to WeCom ← normal path
    │
    └──→ [router] agent_end event
            │
            ├─ matches rule: channel=wecom → forward-copy:inbound
            │   └→ [mqtt] publish to "openclaw/audit/wecom/inbound"
            │
            └─ matches rule: channel=wecom → forward-copy:outbound
                └→ [mqtt] publish to "openclaw/audit/wecom/outbound"
                    │
                    ▼
                [Business system subscribes] → SCRM dashboard sees full conversation
```

**Flow 2: MQ Inbound (Business system → Agent → IM reply)**

```
[Monitoring system] detects CPU > 90%
    │
    ▼
Publish to MQTT: "openclaw/agent/ops/inbound"
    { "content": "⚠️ CPU告警: 生产服务器CPU使用率90%", "metadata": { "severity": "critical" } }
    │
    ▼
[mqtt plugin] → format conversion → OpenClaw message
    │
    ▼
[Agent "ops"] → analyzes → suggests action: "建议立即检查进程, 可能是内存泄漏"
    │
    ├──→ [mqtt plugin] → reply on same topic ← normal path
    │
    └──→ [router] agent_end event
            │
            └─ matches rule: channel=mqtt + topic=openclaw/agent/ops/inbound → reply-via:wecom
                └→ [wecom plugin] → send to user:admin_ops
                    │
                    ▼
                [Ops engineer] receives alert on WeCom
```

**Flow 3: Enhancement Flow (auto-inject on every conversation)**

```
Any message arrives at Agent
    │
    ▼
[router] before_prompt_build event
    │
    ├─ [knowledge] auto-search → "订单API文档: GET /api/orders/{id}…"
    │   └→ inject into system context
    │
    └─ [memory] auto-recall → "用户上次问过退换货政策，对配送时效不满"
        └→ inject into system context
    │
    ▼
[Agent] now has both knowledge context AND user history without any tool call
```

---

## 3. Plugin Design Details

### 3.1 openclaw-router — Message Routing Engine

**Type**: Non-channel plugin (like nacos, prometheus)

**Events monitored**:
- `api.on("agent_end")` — fires after every agent reply, for ALL channels
- `api.on("before_prompt_build")` — fires before every prompt is sent to LLM

**Rule matching**:

```json
{
  "router": {
    "enabled": true,
    "rules": [
      {
        "id": "im-audit-log",
        "match": {
          "channels": ["wecom", "wechat", "dingtalk", "qqbot", "lark"],
          "direction": "both"
        },
        "actions": [
          {
            "type": "forward",
            "target": "mqtt",
            "topic": "openclaw/audit/{{channel}}/{{direction}}"
          }
        ]
      },
      {
        "id": "scrm-customer-reply",
        "match": {
          "channels": ["rabbitmq"],
          "topic": "openclaw/scrm/reply",
          "direction": "inbound"
        },
        "actions": [
          {
            "type": "reply-via",
            "target": "wecom-kf",
            "to": "{{metadata.originalUserId}}"
          }
        ]
      },
      {
        "id": "mq-alert-to-im",
        "match": {
          "channels": ["mqtt"],
          "topic": "openclaw/agent/ops/inbound",
          "direction": "inbound"
        },
        "actions": [
          {
            "type": "reply-via",
            "target": "wecom",
            "accountId": "ops",
            "to": "user:admin_ops"
          }
        ]
      }
    ],
    "knowledge": {
      "autoInject": true,
      "maxResults": 5,
      "scoreThreshold": 0.3
    },
    "memory": {
      "autoInject": true,
      "maxResults": 5
    },
    "audit": {
      "enabled": true,
      "logToConsole": false
    }
  }
}
```

**Rule semantics**:
| Field | Description |
|-------|------------|
| `match.channels` | Which channels to match (empty = all) |
| `match.direction` | `inbound` (user→agent), `outbound` (agent→reply), `both` |
| `match.topic` | MQ topic pattern to match (for MQ channels) |
| `match.accountId` | Specific account to match |
| `action.type` | `forward` (copy to MQ) or `reply-via` (send to IM channel) |
| `action.target` | Target channel ID |
| `action.topic` | MQ topic (supports `{{variable}}` templates) |

**Core code flow** (165 lines):
```typescript
api.on("agent_end", (event, ctx) => {
  for (const rule of cfg.rules) {
    if (matchRule(rule, ctx.channelId, "inbound")) {
      for (const action of rule.actions) {
        if (action.type === "forward") {
          api.publishInbound({ channel: action.target, content: userMsg, topic: action.topic });
        }
      }
    }
    if (matchRule(rule, ctx.channelId, "outbound")) {
      for (const action of rule.actions) {
        if (action.type === "reply-via") {
          api.publishInbound({ channel: action.target, content: agentReply, to: action.to });
        }
      }
    }
  }
});
```

### 3.2 openclaw-memory — Long-Term Memory (L0→L3)

**Architecture**:
```
Conversation start
  → before_prompt_build: keyword search memories → inject context

Conversation end
  → agent_end: capture messages → L0 JSONL recording
  → Pipeline scheduler: every N conversations → L1 extraction
     ├── L1: Extract keywords, save structured memory records
     ├── L2: Scene induction from L1 memories (planned)
     └── L3: Persona generation (planned)
```

**Key differences from memory-tdai reference**:
| memory-tdai | openclaw-memory |
|-------------|-----------------|
| node-llama-cpp for embedding | Remote API (optional) or keyword-only |
| sqlite-vec hard dependency | JSONL primary, SQLite optional |
| L2/L3 scene + persona | L1 keyword first, L2/L3 planned |
| Built-in embedded agent | Reuses OpenClaw's configured LLM |

**Data format** (records JSONL, one line per record):
```json
{ "id": "1716400000_a1b2c3d4", "content": "用户提到：订单、配送、退款…", "type": "episodic", "sessionKey": "agent:sales:wecom:...", "createdAt": "2026-05-19T10:00:00Z" }
```

### 3.3 wecom-kf — Multi-Agent Mapping

**Purpose**: Different WeChat customer service agents map to different AI agents with different styles.

```
Customer Service Agent #1 (售前-热情型)
    │  user "external_user_1" sends message
    ▼
[wecom-kf plugin]
    │  config: accounts.sales_1.agentId = "agent-presale-warm"
    │  config: accounts.sales_1.persona = "热情专业"
    ▼
[Agent "agent-presale-warm"]
    │  personality: warm, proactive, upselling-aware
    │  knowledge: product catalog, pricing FAQ
    │
    ├── reply to WeChat user
    └── [router] forward to MQ for audit
```

### 3.4 knowledge — RAG Auto-Injection

The knowledge plugin (already exists) provides RAG capabilities. The router bridges the gap by auto-injecting search results before the agent processes the message:

```
User message → before_prompt_build
  → router calls knowledge_search tool
  → appends results to system context
  → Agent sees relevant docs without explicitly calling any tool
```

---

## 4. Implementation Phases

### Phase 1: Foundation (current) ✅
| Item | Status |
|------|--------|
| openclaw-router core (165 lines) | ✅ |
| openclaw-memory core (303 lines) | ✅ |
| Enterprise architecture doc | ✅ |
| 29 plugins migrated & standardized | ✅ |

### Phase 2: Deep Integration (2-3 weeks)
| Item | Priority |
|------|----------|
| Channel-to-MQ forwarding in production | P0 |
| MQ-to-Channel reply in production | P0 |
| memory L2 scene extraction using OpenClaw LLM | P1 |
| knowledge auto-injection in production | P1 |
| Audit logging with traceId | P2 |

### Phase 3: Enterprise Platform (ongoing)
| Item |
|------|
| Multi-agent human transfer (wecom-kf enhanced) |
| Multi-round conversation management with memory |
| MQ high-availability via nacos cluster discovery |
| Business system client SDK |
| Prometheus metrics for message throughput |

---

## 5. Key Design Decisions

### 5.1 Router as external plugin vs. modifying channels

**Decision**: External router plugin. Never modify channel code.

**Rationale**:
- OpenClaw's `agent_end` event fires for all channels — router can observe everything
- Changing channel code creates fork maintenance burden
- External router allows rule changes without redeploying channels
- New IM channels added later automatically get routing capability

### 5.2 Forward vs. Dual-agent

**Decision**: Forward copies (not dual-agent processing).

**Rationale**:
- Forward copies are lightweight — just push message text to MQ
- Business systems receive raw conversation data, can process independently
- No extra LLM cost for forwarding
- Configurable: enable/disable per rule

### 5.3 When MQ→IM reply, who speaks?

**Decision**: The original Agent processes the MQ message, and router forwards the reply.

**Rationale**:
- Single pool of agents, cost-effective
- Agent has full conversation context from session
- Business system can include metadata to guide the reply

### 5.4 Unified Message Format

**Decision**: Lightweight SDK (`@partme.ai/message-sdk`), not required for plugins to use.

**Contains**:
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

## 6. Verification

```bash
# Start OpenClaw with router + memory + IM + MQ
openclaw gateway --port 18789

# Install plugins
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/openclaw-mqtt
openclaw plugins install @partme.ai/openclaw-router
openclaw plugins install @partme.ai/openclaw-memory

# Configure cross-channel routing in openclaw.json
# ... router.rules as shown above ...

# Test flow:
# 1. Send message in WeCom → check MQTT topic receives copy
# 2. Publish to MQTT → check WeCom receives reply
# 3. Check before_prompt_build injects knowledge + memory context
```

## About openclaw-plugins

This document is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and further developed by the **PartMe.AI team**, containing 29 plugins across IM channels, message queues, AI capabilities, and infrastructure.

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure.

> 📧 Contact: partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)
