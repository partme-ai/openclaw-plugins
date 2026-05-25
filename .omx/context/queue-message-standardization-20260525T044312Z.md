# Queue Message Standardization Context Snapshot

## Task statement

Review the OpenClaw queue plugins (`rabbitmq`, `mqtt`, `web-mqtt`, `stomp`, `web-stomp`, `redis-stream`, `gotify`) and the shared `extensions/message-sdk` to determine whether queue message formats are consistent today. Improve documentation for standard OpenClaw wire messages, non-standard/raw payload handling, adapter behavior, per-plugin configuration, and cross-language SDK guidance.

## Desired outcome

- Clear answer on current format consistency by plugin.
- Central Chinese and English queue message format guides under `doc/`.
- Links from `doc/README.md` and relevant plugin READMEs.
- Practical examples for standard messages, non-standard normalization, replies, and language SDK usage.
- Low-risk parsing or formatting fixes if inconsistencies are found.
- Verification evidence, commit, and normal push to the current branch.

## Known facts/evidence

- Repository root for this task is `/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins`.
- Shared SDK exists at `extensions/message-sdk`.
- Target queue plugins exist under `extensions/`.
- Existing queue reliability documentation exists under `doc/`.
- Several plugin READMEs include Chinese variants (`README.zh-CN.md`).

## Constraints

- Do not reduce the seven-plugin scope silently.
- Prefer docs and low-risk fixes in this iteration; full publishable SDK packages for every language may be documented as follow-up if too large.
- Run `git diff --check` before completion.
- If code changes are made, add/update tests and run relevant package tests/build.
- Commit and push to the current branch without force pushing.

## Unknowns/open questions

- Exact `message-sdk` envelope and serialization API shape.
- Whether each plugin uses the shared SDK ingress/egress/bridge helpers consistently.
- Whether inbound raw payload parsing has unsafe JSON assumptions or inconsistent fallback behavior.
- Existing documentation language pattern for central docs and plugin README links.
- Package manager and test scripts for this repo.

## Likely codebase touchpoints

- `extensions/message-sdk/src/ingress/index.ts`
- `extensions/message-sdk/src/bridge/index.ts`
- `extensions/message-sdk/README.zh-CN.md`
- `extensions/{rabbitmq,mqtt,web-mqtt,stomp,web-stomp,redis-stream,gotify}/src/inbound.ts`
- `extensions/{rabbitmq,mqtt,web-mqtt,stomp,web-stomp,redis-stream,gotify}/src/outbound.ts`
- `extensions/{rabbitmq,mqtt,web-mqtt,stomp,web-stomp,redis-stream,gotify}/src/transport/server.ts`
- `extensions/{rabbitmq,mqtt,web-mqtt,stomp,web-stomp,redis-stream,gotify}/src/config.ts`
- `extensions/{rabbitmq,mqtt,web-mqtt,web-stomp,stomp,redis-stream,gotify}/README*.md`
- `doc/README.md`
- New `doc/OpenClaw-Queue-Message-Format-Guide.md`
- New English counterpart if documentation pattern supports it.
