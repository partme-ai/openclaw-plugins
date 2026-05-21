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

## MVP 验收清单（§3.3）

| # | 步骤 | 命令 / 操作 |
|---|------|-------------|
| 1 | 启动 OpenMem sidecar | `cd OpenMem && pnpm install && pnpm --filter @openmem/server dev` |
| 2 | 健康检查 | `curl -s http://127.0.0.1:3317/healthz` → `status: ok` |
| 3 | 端到端 smoke | `bash OpenMem/scripts/mvp-smoke.sh` |
| 4 | 加载本插件 | `openclaw plugins install -l ./extensions/openmem`（在 openclaw-plugins 仓库根目录） |
| 5 | 对话后 recall | 多轮对话 → `agent_end` ingest → 新会话调用 `openmem_search` 或 Memory 召回可见上下文 |

可选：快照一致性 `pnpm --filter @openmem/cli start snapshot`（见 `OpenMem/docs/migration/v0-mvp.md`）。

## Tests

```bash
cd openclaw-plugins/extensions/openmem
pnpm install
pnpm test
```
