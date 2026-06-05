# Queue/Channel OpenClaw E2E Context Snapshot

**Timestamp (UTC):** 20260524T122835Z  
**Workspace:** `/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins`  
**Branch:** `feature/v2026-05-22` (ahead of origin by 3 commits)

## Task

Complete full local OpenClaw-installed plugin integration testing for queue/channel plugins:
`mqtt`, `rabbitmq`, `rocketmq`, `gotify`, `stomp`, `web-mqtt`, `web-stomp`.

## Desired Outcome

- Each plugin built, packed, installed into isolated OpenClaw profile (`queue-e2e`)
- Docker-backed external services running where required (RabbitMQ, RocketMQ proxy, Gotify)
- Installed gateway proves traffic handling via health endpoints, protocol clients, and browser UI (web-*)
- Committed reusable E2E scripts + evidence report

## Prior Evidence

| Commit   | Scope |
|----------|-------|
| `1cb0905` | mqtt/gotify source validation |
| `af162c0` | stomp/web validation |
| `dac1f94` | rabbit/rocket validation |

Prior work stopped at unit/docker-integration tests against transport modules directly, not installed OpenClaw gateway path.

## Constraints

- Do not commit secrets; use Docker-generated local tokens only
- Preserve unrelated git changes (wecom docs, deleted files)
- Do not overwrite main `~/.openclaw/openclaw.json` secrets — use `--profile queue-e2e`
- Chinese final report preferred

## Unknowns

- RocketMQ 5.x Docker proxy health on macOS (heavy; best effort)
- Whether gateway dispatch requires configured LLM agent for inbound ack (may verify transport + stats even if agent dispatch fails)
- `openclaw plugins install -l` peer dependency behavior for `@partme.ai/openclaw-message-sdk`

## Likely Touchpoints

- `scripts/e2e/` — docker-compose, install, orchestrator, per-plugin tests
- `test-web/` — browser UI for web-mqtt / web-stomp
- `~/.openclaw-queue-e2e/` — isolated OpenClaw state
- OpenClaw CLI: `~/.openclaw/extensions/wecom/node_modules/.bin/openclaw`
- Plugin packages under `extensions/{mqtt,rabbitmq,rocketmq,gotify,stomp,web-mqtt,web-stomp}`

## Environment (preflight)

- Docker Desktop: installed at `/Applications/Docker.app`; daemon was down, started via `open -a Docker`
- OpenClaw CLI: `2026.5.22` via wecom extension node_modules
- Main config `~/.openclaw/openclaw.json`: JSON5 syntax error (missing comma line ~828) — **not fixing main config**; using isolated profile
