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

Start OpenMem server: `cd OpenMem && pnpm dev:server` (port 3317).
