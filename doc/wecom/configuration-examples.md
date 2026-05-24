# WeCom Progressive Configuration Examples

Copy-paste `openclaw.json` fragments by capability level. Each level **builds on** the previous one.

> Flat `channels.wecom.*` structure (not `wecom-kf` nested `bot:{}`). Multi-account uses `accounts`; account-level fields override top-level fields.

**See also**: [Configuration guide](./OpenClaw-WeCom-Configuration.md) · [Testing](./OpenClaw-WeCom-Testing.md) · [README](../../extensions/wecom/README.md)

---

## Level 1 — Minimal Bot WebSocket (DM chat)

**Unlocks**: WebSocket long connection for private chat; no public IP required.

**Prerequisites** (WeCom admin):

1. Security & Management → Admin Tools → **Smart Robot** → Create (**API mode**)
2. Copy **Bot ID** and **Secret**

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>"
    }
  }
}
```

**Verify**:

```bash
openclaw gateway restart
openclaw channels status --probe
```

Send `hello` to the bot in WeCom; you should get an AI reply and WS auth success in Gateway logs.

---

## Level 2 — Welcome message and user-facing templates

**Unlocks**: Enter-chat welcome and customizable status strings (thinking, tools, timeout, etc.).

**Prerequisites**: Level 1.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "Hi — I'm your enterprise AI assistant.",
      "thinkingText": "Thinking…",
      "toolStatusText": "Running {toolName}…",
      "emptyReplyText": "Sorry, I can't answer that right now.",
      "timeoutText": "Request timed out. Please try again."
    }
  }
}
```

**Verify**:

1. Re-open the bot chat → `welcomeText` appears
2. Ask a reasoning question → status line shows custom `thinkingText`

Full `*Text` keys: `extensions/wecom/src/config/text-config.ts`.

---

## Level 3 — Streaming, footer, thinking placeholder

**Unlocks**: Incremental (typewriter) replies, status/elapsed footer, optional thinking placeholder.

**Prerequisites**: Level 2.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "welcomeText": "Hi — I'm your enterprise AI assistant.",
      "thinkingText": "Thinking…",
      "sendThinkingMessage": true,
      "streaming": {
        "enabled": true,
        "status": true,
        "content": true
      },
      "footer": {
        "status": true,
        "elapsed": true
      },
      "finishFooterText": "⏱ {elapsed}s · done"
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `streaming: false` | Default: status line + final bundle (no typewriter) |
| `streaming: true` or nested object | Status updates + incremental answer |
| `sendThinkingMessage` | Send thinking placeholder (default `true`) |
| `streamPlaceholderText` | Protocol first-frame placeholder; usually leave default |

**Verify**:

```bash
openclaw config set channels.wecom.streaming true
openclaw gateway restart
```

Send a long question; reply should stream; footer shows elapsed time. See [Streaming architecture](./OpenClaw-WeCom-Streaming-Architecture.md).

---

## Level 4 — Access control (DM / groups)

**Unlocks**: DM pairing/allowlist, group allowlist, per-group sender allowlist.

**Prerequisites**: Level 3 (or Level 1 minimum).

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dmPolicy": "pairing",
      "allowFrom": ["zhangsan", "lisi"],
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["wr1234567890abcdef"],
      "groups": {
        "wr1234567890abcdef": {
          "allowFrom": ["zhangsan", "admin_userid"]
        }
      },
      "streaming": true,
      "welcomeText": "Access verified — how can I help?"
    }
  }
}
```

**Verify**:

```bash
openclaw pairing list wecom
openclaw pairing approve wecom <CODE>
```

Unauthorized users get a pairing code; allowed users chat normally.

---

## Level 5 — Media + mediaLocalRoots + maxBytes

**Unlocks**: Inbound image/voice/file/video decrypt; outbound local files; size limits.

**Prerequisites**: Level 4 (or Level 1 if you only need media).

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "mediaLocalRoots": [
        "~/Downloads",
        "~/Documents/reports"
      ],
      "media": {
        "maxBytes": 20971520
      },
      "mediaErrorNoAccessText": "Cannot access that path — ask admin to add mediaLocalRoots.",
      "streaming": true
    }
  }
}
```

> **Not wired (types only)**: `media.tempDir`, `media.retentionHours`, `media.cleanupOnStart` — do not rely on them.

**Verify**:

1. Send an image to the bot → normal reply
2. Agent reply with a file under `mediaLocalRoots` → file sends successfully

---

## Level 6 — Agent mode (self-built app)

**Unlocks**: HTTP callback inbound, **proactive push**, Cron, large/full-format outbound.

**Prerequisites** (WeCom admin):

1. Apps → **Self-built app** → Create
2. Copy **CorpID**, **CorpSecret**, **AgentId**
3. App → **API Receive Messages** → **Token**, **EncodingAESKey** (43 chars)
4. Configure Gateway **first**, then save callback URL in admin

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
        "welcomeText": "Welcome to the enterprise app assistant."
      },
      "network": {
        "agentReplyTimeoutMs": 360000
      }
    }
  }
}
```

Callback URL: `https://<gateway-host>/plugins/wecom/agent/default`

**Verify**:

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw message send --channel wecom --account default --target user:zhangsan --message "Agent outbound test"
```

---

## Level 7 — Dual mode Bot WS + Agent (production)

**Unlocks**: Bot for streaming chat; Agent for files, Cron, broadcast; auto-fallback when WS unavailable.

**Prerequisites**: Level 1 bot credentials + Level 6 agent credentials.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "streaming": true,
      "footer": { "status": true, "elapsed": true },
      "mediaLocalRoots": ["~/Downloads"],
      "media": { "maxBytes": 20971520 },
      "dmPolicy": "open",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_CALLBACK_TOKEN>",
        "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>"
      },
      "network": {
        "agentReplyTimeoutMs": 360000,
        "egressProxyUrl": "http://proxy.company.local:3128"
      }
    }
  }
}
```

**Verify**: Bot DM streams; large file in group → DM file + group hint; Cron:

```bash
openclaw cron add \
  --name "wecom-daily" \
  --agent main \
  --cron "0 9 * * 1-5" \
  --tz "Asia/Shanghai" \
  --message "Daily briefing" \
  --announce --channel wecom --to "party:1"
```

---

## Level 8 — Multi-account

**Unlocks**: Separate ops/sales bots; `defaultAccount` for default outbound.

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "dmPolicy": "open",
      "streaming": true,
      "accounts": {
        "ops": {
          "name": "Ops assistant",
          "botId": "<OPS_BOT_ID>",
          "secret": "<OPS_BOT_SECRET>",
          "agent": {
            "corpId": "ww1234567890abcdef",
            "corpSecret": "<OPS_CORP_SECRET>",
            "agentId": 1000002,
            "token": "<OPS_TOKEN>",
            "encodingAESKey": "<OPS_AES_KEY>"
          }
        },
        "sales": {
          "name": "Sales assistant",
          "dmPolicy": "allowlist",
          "allowFrom": ["zhangsan"],
          "botId": "<SALES_BOT_ID>",
          "secret": "<SALES_BOT_SECRET>"
        }
      }
    }
  }
}
```

**Verify**:

```bash
openclaw channels list
openclaw message send --channel wecom --account sales --target zhangsan --message "Sales bot test"
```

---

## Level 9 — Knowledge base / RAG

**Unlocks**: Auto RAG injection before prompts; `knowledge_*` tools for AI CRUD.

**Prerequisites**:

1. Working WeCom channel (Level 7–8)
2. Install knowledge plugin separately (`@partme.ai/wecom` does **not** embed knowledge hooks today)

```bash
openclaw plugins install @partme.ai/openclaw-knowledge
```

```json
{
  "plugins": {
    "entries": {
      "knowledge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "embedding": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          },
          "store": {
            "provider": "zvec",
            "dbPath": "./data/knowledge-wecom.db"
          },
          "retrieval": {
            "strategy": "hybrid",
            "topK": 5,
            "minScore": 0.3
          }
        }
      }
    }
  },
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "connectionMode": "websocket",
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o-mini"
    }
  }
}
```

| Topic | Notes |
|-------|-------|
| Standalone plugin | Use `plugins.entries.knowledge.config` ([knowledge INSTALL](../../extensions/knowledge/INSTALL.md)) |
| `channels.wecom.knowledge` | Used when channel embeds `registerKnowledgeHooks(...)` — **not** in current `@partme.ai/wecom` source |
| Namespace | Runtime isolation: `{accountId}:bot` or `{accountId}:agent` |

**Verify**:

```bash
openclaw gateway restart
openclaw run knowledge:stats
```

**Further reading**: [Knowledge RAG guide](../knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) · [Integration](../knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md)

---

## Level 10 — Advanced: dynamicAgents, proxy, ASR, webhook

### 10a — Dynamic agents + egress proxy

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<YOUR_BOT_ID>",
      "secret": "<YOUR_BOT_SECRET>",
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin_userid"]
      },
      "network": {
        "egressProxyUrl": "http://proxy.company.local:3128",
        "agentReplyTimeoutMs": 360000
      },
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>"
      }
    }
  }
}
```

> **Not wired**: `network.retries`, `network.retryDelayMs`.

### 10b — Agent voice ASR (Tencent Flash)

```json
{
  "channels": {
    "wecom": {
      "agent": {
        "corpId": "ww1234567890abcdef",
        "corpSecret": "<YOUR_CORP_SECRET>",
        "agentId": 1000002,
        "token": "<YOUR_TOKEN>",
        "encodingAESKey": "<YOUR_AES_KEY>",
        "asr": {
          "appId": "<TENCENT_APP_ID>",
          "secretId": "<TENCENT_SECRET_ID>",
          "secretKey": "<TENCENT_SECRET_KEY>",
          "engineType": "16k_zh",
          "voiceFormat": "amr"
        }
      }
    }
  }
}
```

### 10c — Bot webhook (instead of WebSocket)

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "connectionMode": "webhook",
      "token": "<WEBHOOK_TOKEN>",
      "encodingAESKey": "<YOUR_43_CHAR_AES_KEY>",
      "receiveId": "<BOT_OR_CORP_ID>",
      "welcomeText": "Welcome via webhook.",
      "streamPlaceholderText": "1",
      "streaming": true
    }
  }
}
```

Callback: `https://<gateway-host>/plugins/wecom/bot/default`

---

## Unimplemented keys

| Key | Status |
|-----|--------|
| `media.tempDir` | Type only |
| `media.retentionHours` | Type only |
| `media.cleanupOnStart` | Type only |
| `network.retries` | Type only |
| `network.retryDelayMs` | Type only |

## Source of truth

| Module | Path |
|--------|------|
| Main config | `extensions/wecom/src/config/wecom-config.ts` |
| *Text templates | `extensions/wecom/src/config/text-config.ts` |
| Streaming | `extensions/wecom/src/config/streaming-config.ts` |
| Multi-account | `extensions/wecom/src/config/accounts.ts` |
