# OpenClaw OpenMem Plugin

Bridges OpenClaw agents to a local [OpenMem](https://github.com/partme-ai) server.

## Configuration

```json
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317"
        }
      }
    }
  }
}
```

## Behavior

- **Recall**: `MemorySearchManager.search` → `POST /inspect/search` (hybrid mode)
- **Ingest**: `agent_end` → `POST /events/ingest` with session messages
- **Tool**: `openmem_search` for explicit agent queries

Start OpenMem server: `cd OpenMem && pnpm dev:server` (port **3317**).

## MVP Verification Checklist

| # | Step | Command / Action |
|---|------|-----------------|
| 1 | Start OpenMem sidecar | `cd OpenMem && pnpm install && pnpm --filter @openmem/server dev` |
| 2 | Health check | `curl -s http://127.0.0.1:3317/healthz` → `status: ok` |
| 3 | End-to-end smoke test | `bash OpenMem/scripts/mvp-smoke.sh` |
| 4 | Install the plugin | `openclaw plugins install -l ./extensions/openmem` (from openclaw-plugins root) |
| 5 | Conversation then recall | Chat → agent_end ingest → new session uses `openmem_search` or auto-recall for context |

## Tests

```bash
cd extensions/openmem
pnpm install
pnpm test
```
