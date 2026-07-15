# OpenClaw OpenMem

Production-oriented OpenMem REST bridge for OpenClaw 2026.7.1.

[简体中文](./README.zh-CN.md) | [English](./README.md)

## What it implements

- OpenMem session start, append, and commit across OpenClaw session lifecycle hooks.
- Current-turn ingestion with deterministic event IDs for idempotent retries.
- `MemorySearchManager` automatic recall and the `openmem_search` tool.
- Request timeouts, bounded retries, response-size limits, JSON/schema validation, health checks, and shutdown cancellation.
- Optional environment-backed auth headers for a protecting reverse proxy.

OpenMem currently performs FTS5 plus character n-gram reranking. It does not currently expose embedding/vector recall, and this plugin reports that capability accurately.

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
          "maxResponseBytes": 2097152,
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

## OpenMem server boundary

The current workspace OpenMem server has no built-in request authentication and does not explicitly bind its listener to loopback. Protect it with container/firewall isolation or an authenticated reverse proxy. The optional auth header is intended for that proxy; it is not presented as native OpenMem authentication.

## Verification

```bash
pnpm --filter @partme.ai/openclaw-openmem test
pnpm --filter @partme.ai/openclaw-openmem typecheck
pnpm --filter @partme.ai/openclaw-openmem build
```

The real integration path is `healthz → sessions/start → events/ingest → sessions/:id/append → sessions/:id/commit → inspect/search`.
