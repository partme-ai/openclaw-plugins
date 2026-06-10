# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **OpenClaw Channel Plugin** for WeCom (企业微信 / WeChat Work). It enables AI bot integration with enterprise WeChat through a multi-mode architecture.

- **Package**: `@partme.ai/wecom`
- **Type**: ES Module (NodeNext)
- **Entry**: `index.ts`

## Architecture

### Multi-Mode Design (WebSocket + Webhook Bot + Agent)

The plugin implements three connection modes:

| Mode | Purpose | Webhook Path | Capabilities |
|------|---------|--------------|--------------|
| **WebSocket** (Bot 长连接) | Real-time streaming chat | N/A (WS) | Streaming responses, low latency |
| **Webhook** (Bot URL 回调) | HTTP callback for restricted networks | `/wecom`, `/wecom/bot`, `/plugins/wecom/bot` | Streaming via `response_url`, 6min window, Agent fallback |
| **Agent** (自建应用) | Fallback & broadcast | `/wecom/agent`, `/plugins/wecom/agent` | File sending, broadcasts, long tasks (>6min) |

**Key Design Principle**: Bot is preferred for conversations; Agent is used as fallback when Bot cannot deliver (files, timeouts) or for proactive broadcasts.

### Core Components

```
index.ts                  # Plugin entry — registers channel, wecom_mcp tool, HTTP routes, before_prompt_build hook
src/
  # ── Channel + lifecycle ──
  channel.ts              # ChannelPlugin implementation (WS gateway, webhook dispatch, account lifecycle)
  monitor.ts              # WebSocket inbound message processing + stream reply delivery
  runtime.ts              # Runtime state singleton (setWeComRuntime / getWeComRuntime)

  # ── Configuration + accounts ──
  accounts.ts             # Multi-account resolution (resolveWeComAccountMulti, setWeComAccountMulti)
  onboarding.ts           # Setup wizard: applyAccountConfig, dmPolicy helpers, configure prompts
  const.ts                # Channel ID, webhook paths, API endpoints, media constants
  state-dir-resolve.ts    # State directory path resolution
  version.ts              # Version info

  # ── HTTP + network ──
  http.ts                 # undici fetch wrapper with proxy support

  # ── Message handling ──
  message-parser.ts       # Inbound XML/JSON message parsing (text, image, voice, video, file, event, etc.)
  message-sender.ts       # Outbound message dispatch (Bot WS / Bot webhook / Agent fallback)
  target.ts               # Target resolution (user/party/tag/chat)

  # ── Stream state (WebSocket mode) ──
  state-manager.ts        # StreamStore + ActiveReplyStore: stream tracking, response_url tracking
  reqid-store.ts          # Request ID deduplication store
  chat-queue.ts           # Pending message queue with debounce (500ms default)
  response-url-tracker.ts # Response URL registry for proactive message delivery
  timeout.ts              # Stream expiration timeout handler (6-min window + 30s margin)

  # ── Media handling ──
  media-handler.ts        # Inbound media download + decryption (AES-256-CBC)
  media-uploader.ts       # Outbound media upload via Agent API
  ws-media.ts             # Native WebSocket image item builder (for inline msg_item delivery)
  temp-media-server.ts    # Temporary media HTTP server (token-authenticated, 15-min TTL)

  # ── Template cards ──
  template-card-parser.ts # Inbound template card event parsing
  template-card-manager.ts# Template card lifecycle management

  # ── Dynamic agents + routing ──
  dynamic-agent.ts        # Dynamic agent creation (per-user/per-group isolation)
  dynamic-routing.ts      # Dynamic agent routing policy
  dm-policy.ts            # DM access policy (open / allowlist / blocklist)
  group-policy.ts         # Group chat access policy (open / allowlist / blocklist)

  # ── SDK compatibility ──
  openclaw-compat.ts      # SDK version shim (emptyPluginConfigSchema, etc.)
  utils.ts                # Shared utilities

  # ── Webhook mode (Bot URL callback) ──
  webhook/
    index.ts              # Re-exports: handleWecomWebhookRequest
    handler.ts            # HTTP GET/POST handler with multi-account signature matching
    gateway.ts            # Lifecycle: start/stop webhook targets, prune timer
    monitor.ts            # startAgentForStream() — process inbound, dispatch Agent, deliver replies
    state.ts              # StreamStore + ActiveReplyStore + WebhookMonitorState (singleton)
    helpers.ts            # buildInboundBody, processInboundMessage, buildFallbackPrompt, MIME detect
    types.ts              # WebhookInboundMessage, StreamState, PendingInbound, WecomWebhookTarget
    target.ts             # Path-indexed target registry (register/unregister/resolve)
    http.ts               # undici fetch wrapper with ProxyAgent
    media.ts              # AES-256-CBC media decryption (decryptWecomMediaWithMeta)
    command-auth.ts       # DM policy + command authorization
    video-frame.ts        # ffmpeg first-frame extraction for video messages

  # ── Agent mode (自建应用) ──
  agent/
    index.ts              # Re-exports
    api-client.ts         # WeCom API client with AccessToken caching + refresh
    handler.ts            # Agent request handler: dispatch to OpenClaw agent, deliver replies
    webhook.ts            # Agent HTTP handler (GET echostr verify, POST XML decrypt + signature check)
    xml.ts                # XML parsing utilities for Agent callbacks
    asr.ts                # Voice message speech-to-text via WeCom ASR API
    stream.ts             # Agent streaming response handler
    voice-transcode.ts    # Voice format transcoding (AMR → WAV/MP3)
    welcome.ts            # Welcome message on first connection
    capabilities.ts       # Agent capability detection
    markdown-strip.ts     # Strip markdown for plain-text WeCom messages

  # ── MCP tool ──
  mcp/
    index.ts              # Re-exports: createWeComMcpTool
    tool.ts               # wecom_mcp tool implementation (JSON-RPC over Streamable HTTP)
    transport.ts          # MCP transport layer (undici-based HTTP with WeCom auth)
    schema.ts             # MCP tool input schemas
    config-fetch.ts       # Auto-fetch WeCom doc MCP config via WS after connection
    interceptors/         # MCP response interceptors (smartpage, smartsheet, biz-error, doc-auth, msg-media)

  # ── Shared utilities ──
  shared/
    command-auth.ts       # Command authorization utilities
    xml-parser.ts         # XML parse/serialize with fast-xml-parser

  # ── TypeScript types ──
  types/
    index.ts              # Re-exports all types
    account.ts            # WeComAccount, WeComAccountConfig
    config.ts             # WeComChannelConfig, WeComConfig (Zod schemas)
    constants.ts          # Type-level constants
    message.ts            # WeComMessage, InboundMessageBody, MessageType
    global.d.ts           # Global type declarations

  # ── Tests (co-located) ──
  message-parser.test.ts
  chat-queue.test.ts
  template-card-parser.test.ts
  reqid-store.test.ts
  webhook/command-auth.test.ts
  webhook/helpers.test.ts
  webhook/state.test.ts
  agent/markdown-strip.test.ts
  agent/welcome.test.ts
  mcp/tool.test.ts
  mcp/transport.test.ts
  shared/xml-parser.test.ts
```

### Core Data Flow

**WebSocket mode** (`src/monitor.ts` + `src/state-manager.ts`):
- **StreamStore**: Manages message streams with 6-minute timeout window
- **ActiveReplyStore**: Tracks `response_url` for proactive pushes
- **Chat Queue** (`chat-queue.ts`): Debounces rapid messages (500ms default)
- **ReqId Store** (`reqid-store.ts`): Message deduplication via `msgid`
- **Session Chat Info** (`state-manager.ts`): `getSessionChatInfo()` for MCP tool context (preserves original-case chatId)

**Webhook mode** (`src/webhook/state.ts` + `src/webhook/monitor.ts`):
- Separate singleton (`WebhookMonitorState`) with same StreamStore + ActiveReplyStore pattern
- Additional `conversationState`/`batchKey`/`ackStream` queue semantics for multi-message merge
- Used by `webhook/gateway.ts` and `webhook/monitor.ts`

### Token Management

Agent mode uses automatic AccessToken caching (`src/agent/api-client.ts`):
- Token cached with 60-second refresh buffer
- Automatic retry on expiration
- Thread-safe refresh deduplication

## Development Commands

### Testing

This project uses **Vitest**:

```bash
# Run all tests
npx vitest --config vitest.config.ts run

# Run specific test file
npx vitest --config vitest.config.ts run src/crypto.test.ts

# Run tests matching pattern
npx vitest --config vitest.config.ts run -t "should encrypt"

# Watch mode
npx vitest --config vitest.config.ts --watch
```

Test files are located alongside source files with `.test.ts` suffix (12 test files, 273 test cases):
- `src/message-parser.test.ts`
- `src/chat-queue.test.ts`
- `src/template-card-parser.test.ts`
- `src/reqid-store.test.ts`
- `src/webhook/command-auth.test.ts`
- `src/webhook/helpers.test.ts`
- `src/webhook/state.test.ts`
- `src/agent/markdown-strip.test.ts`
- `src/agent/welcome.test.ts`
- `src/mcp/tool.test.ts`
- `src/mcp/transport.test.ts`
- `src/shared/xml-parser.test.ts`

### Type Checking

```bash
npx tsc --noEmit
```

### Build

Build via `tsc` (TypeScript compiler):

```bash
pnpm build      # tsc → dist/
pnpm typecheck  # tsc --noEmit
```

## Configuration Schema

Configuration is validated via Zod (`src/types/config.ts`):

```typescript
{
  enabled: boolean,
  bot: {
    connectionMode: 'websocket' | 'webhook',
    // WebSocket mode:
    botId: string,
    secret: string,
    // Webhook mode:
    token: string,              // Bot webhook token
    encodingAESKey: string,     // AES encryption key
    receiveId: string?,         // Optional receive ID
    streamPlaceholderText: string?,  // Bot stream first-frame placeholder
    welcomeText: string?,
    dm: { policy, allowFrom }
  },
  agent: {
    corpId: string,
    corpSecret: string,
    agentId: number,
    token: string,              // Callback token
    encodingAESKey: string,     // Callback AES key
    welcomeText: string?,
    dm: { policy, allowFrom }
  },
  accounts: {                   // Multi-account (matrix mode)
    main: { bot: {...}, agent: {...} }
  },
  network: {
    egressProxyUrl: string?     // For dynamic IP scenarios
  },
  media: {
    maxBytes: number?           // Default 20MB
  },
  dynamicAgents: {
    enabled: boolean?           // Enable per-user/per-group agents
    dmCreateAgent: boolean?     // Create agent per DM user
    groupEnabled: boolean?      // Enable for group chats
    adminUsers: string[]?       // Admin users (bypass dynamic routing)
  }
}
```

### Dynamic Agent Routing

When `dynamicAgents.enabled` is `true`, the plugin automatically creates isolated Agent instances for each user/group:

```bash
# Enable dynamic agents
openclaw config set channels.wecom.dynamicAgents.enabled true

# Configure admin users (use main agent)
openclaw config set channels.wecom.dynamicAgents.adminUsers '["admin1","admin2"]'
```

**Generated Agent ID format**: `wecom-{type}-{peerId}`
- DM: `wecom-dm-zhangsan`
- Group: `wecom-group-wr123456`

Dynamic agents are automatically added to `agents.list` in the config file.

## Key Technical Details

### Webhook Security

- **Signature Verification**: SHA1(token, timestamp, nonce, encrypt) via `@wecom/aibot-node-sdk` WecomCrypto
- **Encryption**: AES-256-CBC with PKCS#7 padding (32-byte blocks)
- **Paths**: `/wecom` (legacy), `/wecom/bot` (bot), `/wecom/agent` (agent), `/plugins/wecom/bot/*`, `/plugins/wecom/agent/*`

### Timeout Handling

Bot webhook mode has a 6-minute window (360s) for streaming responses. The plugin:
- Tracks deadline: `createdAt + 6 * 60 * 1000`
- Switches to Agent fallback at `deadline - 30s` margin
- Sends DM via Agent for remaining content

### Media Handling

- **Inbound**: Decrypts WeCom encrypted media URLs (AES-256-CBC)
- **Outbound Images**: Base64 encoded via `msg_item` in stream
- **Outbound Files**: Requires Agent mode, sent via `media/upload` + `message/send`
- **Max Size**: 20MB default (configurable via `channels.wecom.media.maxBytes`)

### Proxy Support

For servers with dynamic IPs (common error: `60020 not allow to access from your ip`):

```bash
openclaw config set channels.wecom.network.egressProxyUrl "http://proxy.company.local:3128"
```

### message tool denial

`buildCfgForDispatch()` in `webhook/helpers.ts` adds `"message"` to `tools.deny` to prevent Agent from bypassing Bot delivery via the message tool.

## Testing Notes

- Tests use Vitest with co-located test files
- Integration tests mock WeCom API responses
- Crypto tests verify AES encryption round-trips
- Monitor tests cover stream state transitions and queue behavior

## Common Patterns

### Adding a New Message Type Handler

1. Update `buildInboundBody()` in `src/webhook/helpers.ts` or `src/monitor.ts` to parse the message
2. Add type definitions in `src/types/message.ts`
3. Update `processInboundMessage()` if media handling is needed

### Agent API Calls

Always use `api-client.ts` methods which handle token management:

```typescript
import { sendText, uploadMedia } from "./agent/api-client.js";

// Token is automatically cached and refreshed
await sendText({ agent, toUser: "userid", text: "Hello" });
```

### Stream Content Updates

Use `streamStore.updateStream()` for thread-safe updates:

```typescript
streamStore.updateStream(streamId, (state) => {
  state.content = "new content";
  state.finished = true;
});
```

## Dependencies

- `@partme.ai/openclaw-message-sdk`: Shared message types and utilities
- `@wecom/aibot-node-sdk`: Official WeCom Bot WebSocket SDK + crypto (signature verification, AES encrypt/decrypt)
- `undici`: HTTP client with proxy support (used in webhook/http.ts for outbound requests)
- `fast-xml-parser`: XML parsing for Agent callbacks
- `file-type`: MIME type detection from file buffers
- `zod`: Configuration validation
- `openclaw`: Peer dependency (>=2026.4.12)

## WeCom API Endpoints Used

- `GET_TOKEN`: `https://qyapi.weixin.qq.com/cgi-bin/gettoken`
- `SEND_MESSAGE`: `https://qyapi.weixin.qq.com/cgi-bin/message/send`
- `SEND_APPCHAT`: `https://qyapi.weixin.qq.com/cgi-bin/appchat/send`
- `UPLOAD_MEDIA`: `https://qyapi.weixin.qq.com/cgi-bin/media/upload`
- `DOWNLOAD_MEDIA`: `https://qyapi.weixin.qq.com/cgi-bin/media/get`
