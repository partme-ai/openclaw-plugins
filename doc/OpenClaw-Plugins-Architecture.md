# openclaw-plugins — Enterprise Architecture

## 1. Overview

openclaw-plugins is an enterprise OpenClaw plugin collection developed and further developed by the **PartMe.AI team**, containing 28 plugins. Its goal is to use OpenClaw Agents as the hub, connecting IM channels, message queues, knowledge bases, and long-term memory into a closed-loop multi-platform information flow.

### 1.1 What We Have

```
                       OpenClaw Gateway
                              │
       ┌──────────────┬───────┴────────┬──────────────┐
       ▼              ▼                ▼              ▼
 Business / IM     Messaging and     Capabilities    Infrastructure / SDK
 channels          transports        RAG / Memory   Nacos / tracing / ...
```

### 1.2 What We Need

| Gap | Problem | Solution |
|-----|---------|----------|
| **Cross-channel routing** | WeCom messages cannot auto-forward to MQ; MQ messages cannot reply to IM | openclaw-router |
| **Knowledge out-of-box** | Agents need relevant knowledge without an explicit tool call | knowledge auto-injects RAG through `before_prompt_build` |
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
│  │ Engine   │ │ Engine   │ │ Logger   │ │ Deduplication│  │
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
│  │ Business / IM       │  │ Messaging and transports     │  │
│  │ wecom wechat        │  │ mqtt rabbitmq redis-stream   │  │
│  │ wecom-kf wechat-ipad│  │ stomp web-stomp rocketmq     │  │
│  │ amap douyin bridge… │  │ web-mqtt web-socket gotify  │  │
│  └─────────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Core Design Principle: Don't Modify Channels

The key insight is simple:

> **OpenClaw 2026.7.1 exposes cross-channel `message_received`, `message_sent`, and `reply_dispatch` hooks.**

This means we never modify wecom, dingtalk, or any channel plugin code. The router sits outside, watching all events.

```
wecom plugin:                      openclaw-router:
  register(api) {                    register(api) {
    api.registerChannel({...});        api.on("message_received", inboundHandler);
    // channel protocol adapter only    api.on("message_sent", outboundHandler);
  }                                    api.on("reply_dispatch", replyHandler);
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
    ├──→ [router] message_received
    │       └→ [mqtt] publish to "openclaw/audit/wecom/inbound"
    │
    └──→ [Agent "sales"] → processes → generates reply
            ├──→ [wecom plugin] → send reply to WeCom ← normal path
            └──→ [router] message_sent
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
    └──→ [router] reply_dispatch event
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
[OpenClaw Prompt / Memory Host]
    │
    ├─ [knowledge] `before_prompt_build` auto-search → "订单API文档: GET /api/orders/{id}…"
    │   └→ inject into system context
    │
    └─ [memory] Memory Host auto-recall → "用户上次问过退换货政策，对配送时效不满"
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
- `api.on("message_received")` — forwards inbound message copies
- `api.on("message_sent")` — forwards successfully delivered outbound copies
- `api.on("reply_dispatch")` — performs configured cross-channel `reply-via` actions
- `api.on("gateway_stop")` — clears the process-local deduplication cache

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
            "to": "external-user-id"
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
| `match.topic` | Exact MQ topic match (for MQ channels) |
| `match.accountId` | Specific account to match |
| `action.type` | `forward` (copy to MQ) or `reply-via` (send to IM channel) |
| `action.target` | Target channel ID |
| `action.topic` | MQ topic (supports `{{channel}}`, `{{direction}}`, and `{{account}}`) |

**Core code flow**:
```typescript
api.on("message_received", (event, ctx) => {
  for (const rule of cfg.rules) {
    if (matchRule(rule, ctx.channelId, "inbound")) {
      executeForward(api, cfg, { rule, direction: "inbound", content: event.content });
    }
  }
});

api.on("message_sent", outboundForwardHandler);
api.on("reply_dispatch", replyViaHandler);
```

### 3.2 openclaw-memory — Long-Term Memory (L0→L3)

**Architecture**:
```
Conversation start
  → Memory Host obtains MemorySearchManager
  → framework searches relevant records and injects context

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
| node-llama-cpp for embedding | Keyword-only retrieval with no external dependency |
| sqlite-vec hard dependency | JSONL primary storage; vector backend disabled |
| L2/L3 scene + persona | L1 keyword first, L2/L3 planned |
| Built-in embedded agent | Deterministic keyword extraction; no additional LLM call |

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

The knowledge plugin registers its own `before_prompt_build` hook for automatic RAG injection. It also registers `knowledge_add`, `knowledge_query`, `knowledge_update`, and `knowledge_delete` tools:

```
User message → before_prompt_build
  → knowledge retrieves relevant chunks
  → appends results to system context
  → Agent sees relevant docs without explicitly calling any tool
```

---

## 4. Implementation Phases

### Phase 1: Foundation (current) ✅
| Item | Status |
|------|--------|
| openclaw-router core | ✅ |
| openclaw-memory core | ✅ |
| Enterprise architecture doc | ✅ |
| 28 plugins governed in the monorepo and Profiles | ✅ |
| Existing plugin structure convergence | In progress |

### Phase 2: Deep Integration (in progress)
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
- OpenClaw's `message_received`, `message_sent`, and `reply_dispatch` hooks expose the cross-channel message lifecycle used by router
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

**Decision**: `@partme.ai/openclaw-message-sdk` is the **message layer** for MQ/STOMP/MQTT-style channels: transport plugins publish/subscribe only; parsing, envelopes, stacks, and OpenClaw dispatch go through the SDK.

**MQ / push channels (required)**: `mqtt`, `rabbitmq`, `redis-stream`, `rocketmq`, `stomp`, `web-mqtt`, `web-stomp`, `gotify` (inbound mapping + dedup; Gotify REST outbound stays human-readable).

**Bridge** (subpath `bridge`):

- `dispatchInbound` — `finalizeInboundContext` + `dispatchReplyFromConfig`
- `createReplyHandler` — Agent reply → `serializeForTransport` → plugin `deliver({ wire })`

**Wire envelope (v1)**:

```json
{
  "version": "1",
  "message": {
    "messageId": "mqtt-123",
    "traceId": "trace-123",
    "timestamp": 1784116800000,
    "source": { "channel": "mqtt", "accountId": "default", "userId": "device-1", "chatType": "direct" },
    "contentType": "text",
    "text": "hello",
    "media": [],
    "direction": "inbound"
  },
  "headers": {
    "correlationId": "corr-123",
    "idempotencyKey": "idem-123",
    "replyRoute": { "topic": "openclaw/replies/device-1" }
  }
}
```

Backward compatible with `{ "text": "..." }` and plain text via `parseTransportPayload`.

**Core model** (`UnifiedMessage`): `messageId`, `source` (channel, accountId, userId, optional agentId), `contentType`, `text` / `markdown` / `media`, `metadata`, `timestamp`. See `extensions/message-sdk/docs/ARCHITECTURE.md`.

**WeCom** remains on its native pipeline in phase 1; WeCom-specific stages may move into SDK adapters in a later phase.

---

## 6. Verification

```bash
# Prerequisite: OpenClaw >= 2026.7.1
# Start OpenClaw with router + memory + IM + MQ
openclaw gateway --port 18789

# Install plugins
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/openclaw-mqtt
openclaw plugins install @partme.ai/openclaw-router
openclaw plugins install @partme.ai/openclaw-memory
openclaw plugins install @partme.ai/openclaw-knowledge

# Configure cross-channel routing in openclaw.json
# ... router.rules as shown above ...

# Test flow:
# 1. Send message in WeCom → check MQTT topic receives copy
# 2. Publish to MQTT → check WeCom receives reply
# 3. Check knowledge before_prompt_build and Memory Host injection
```

## About openclaw-plugins

This document is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and further developed by the **PartMe.AI team**, containing 28 plugins across IM channels, message queues, AI capabilities, and infrastructure.

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure.

> 📧 Contact: partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)
