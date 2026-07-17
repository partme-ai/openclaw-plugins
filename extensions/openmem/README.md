# OpenClaw OpenMem

Production-oriented OpenMem REST bridge for OpenClaw 2026.7.1.

[简体中文](./README.zh-CN.md) | [English](./README.md)

## What it implements

- OpenMem session start, append, and commit across OpenClaw session lifecycle hooks.
- Current-turn ingestion with deterministic event IDs for idempotent retries.
- Crash recovery that rebuilds missing working-memory projections from persisted events and deterministic turn markers.
- `MemorySearchManager` automatic recall and the `openmem_search` tool.
- Request-size limits, timeouts, jittered bounded retries, streaming response-size limits, JSON/schema validation, health checks, and shutdown cancellation.
- LRU source cache bounded by both entry count and `maxCacheBytes`.
- Optional environment-backed auth headers for a protecting reverse proxy.

OpenMem currently performs FTS5 plus character n-gram reranking. It does not currently expose embedding/vector recall, and this plugin reports that capability accurately.

## Runtime architecture

```text
OpenClaw hooks / Memory Host / openmem_search
                    │
                    ▼
        Agent + session continuity boundary
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
 stable events/ingest     continuity search
          │                    │
          ▼                    ▼
 marked working append    bounded source LRU
          │                    │
          └─────────┬──────────┘
                    ▼
       OpenMem REST Sidecar (fixed endpoint)
```

```mermaid
flowchart LR
    Hooks["session_start / agent_end / session_end"] --> Scope["Agent + session scope"]
    Tool["Memory Host / openmem_search"] --> Scope
    Scope --> Events["stable events/ingest"]
    Events --> Append["turnId-marked working append"]
    Scope --> Recall["continuity recall<br/>or explicit shared hybrid"]
    Recall --> Cache["bounded source LRU"]
    Append --> Sidecar["OpenMem REST Sidecar"]
    Cache --> Sidecar
```

## Write recovery model

```mermaid
flowchart TD
    A["Current turn"] --> B["Derive stable eventId and turnId"]
    B --> C["Idempotent events/ingest"]
    C --> D{"turnId already in append_notes?"}
    D -- "yes" --> E["Skip non-idempotent append"]
    D -- "no" --> F["Append marked turn to working memory"]
    C -. "process exits" .-> G["Recover ACTIVE session or commit"]
    G --> H["Rebuild recent turns from persisted events"]
    H --> D
```

OpenMem append has no idempotency key, so the plugin never blindly retries it. Operations for the same OpenClaw session are serialized, and recovery/commit reconciles the most recent 1,000 persisted events before archiving.

## Safe defaults

OpenMem hybrid search is sidecar-global and has no tenant filter. The plugin therefore defaults to one configured agent and session continuity recall:

- `agentId: "main"`
- `allowSharedRecall: false`
- non-loopback endpoints require HTTPS

Only enable `allowSharedRecall` when the sidecar belongs to one trusted user/domain.

## Configuration

```jsonc
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317",
          "agentId": "main",
          "required": false,
          "maxSearchResults": 10,
          "timeoutMs": 5000,
          "maxAttempts": 3,
          "retryBaseDelayMs": 100,
          "maxRequestBytes": 2097152,
          "maxResponseBytes": 2097152,
          "maxCacheBytes": 8388608,
          "allowSharedRecall": false,
          "apiKeyEnv": "OPENMEM_API_KEY",
          "authHeader": "Authorization",
          "authScheme": "Bearer"
        }
      }
    }
  }
}
```

`required: true` makes an unavailable sidecar fail Gateway startup. API keys are never accepted inline; `apiKeyEnv` names the environment variable to read.

`maxRequestBytes` and `maxResponseBytes` default to 2 MiB. A turn is capped at 100 messages (16,000 characters each), a search query at 4,000 characters, and a missing trusted session key fails closed instead of writing into a shared fallback thread.

### HTTP safety boundary

```text
Hook / Search → bounded JSON body → fixed Sidecar URL → auth + timeout/cancel
                                                   │
                  jittered retry ◀── safe 408/425/429/5xx only
                                                   │
                                                   ▼
                         bounded response stream → JSON/schema → redaction
```

```mermaid
flowchart LR
    Call["Hook / Search"] --> Body["JSON request byte limit"]
    Body --> URL["fixed origin and path prefix"]
    URL --> Fetch["auth + timeout + lifecycle cancel"]
    Fetch --> Stream["streaming response byte limit"]
    Stream --> Schema["JSON / schema checks"]
    Fetch -->|"retrySafe transient failure"| Retry["jittered exponential backoff"]
    Retry --> Fetch
    Schema --> Safe["official + local redaction"]
```

## OpenMem server boundary

The current workspace OpenMem server has no built-in request authentication and does not explicitly bind its listener to loopback. Protect it with container/firewall isolation or an authenticated reverse proxy. The optional auth header is intended for that proxy; it is not presented as native OpenMem authentication.

## Verification

```bash
pnpm --filter @partme.ai/openclaw-openmem test
pnpm --filter @partme.ai/openclaw-openmem typecheck
pnpm --filter @partme.ai/openclaw-openmem build
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs --plugins openmem --skip-browser
```

The 2026-07-17 gate passes 32 tests plus a tarball-installed OpenClaw 2026.7.1 E2E against the real workspace OpenMem Server: Agent Turn, ingest, working memory, shutdown-drain commit, archive, Gateway restart, continuity recall, and next-turn prompt injection.

`/events/ingest` and `/sessions/:id/append` remain separate Sidecar writes. The plugin now reconciles the normal crash window from persisted events, but strict atomicity beyond the 1,000-event recovery window still requires a transactional Sidecar API or native idempotent append. Protected-network and Sidecar failure-recovery acceptance tests also remain production gates.
