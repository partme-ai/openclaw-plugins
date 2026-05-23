# OpenClaw Gotify

**OpenClaw plugin — Gotify channel bridge with Message API delivery, WebSocket stream inbound handling, and bootstrap helpers**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--gotify-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.en.md) | [简体中文](./README.md)

## Introduction

`@partme.ai/openclaw-gotify` is an OpenClaw native channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) that connects OpenClaw to a self-hosted [Gotify](https://gotify.net/) server. It uses the official OpenClaw channel plugin entrypoint and combines:

- Gotify `Message API` for outbound delivery
- Gotify `WebSocket Stream API` for inbound real-time listening
- Gotify `Application and Client API` for explicit bootstrap / doctor workflows

## Core Capabilities

- **Message API First**: standard outbound send path uses `POST /message`
- **Least Privilege Runtime**: normal delivery only requires an application token
- **Optional Inbound Stream**: enable WebSocket listener with a client token when you want Gotify -> OpenClaw input
- **Bootstrap Helpers**: doctor and application bootstrap are explicit workflows, not hidden runtime side effects
- **dmScope Isolation**: session isolation follows OpenClaw `session.dmScope` only
- **Multi-Account Routing**: route different OpenClaw agents to different Gotify accounts without session bleed

## Architecture

```text
OpenClaw agent reply
  -> gotify outbound adapter
  -> Gotify POST /message
  -> Gotify server fan-out

Gotify /stream
  -> WebSocket listener
  -> dmScope session key resolution
  -> OpenClaw reply runtime pipeline
  -> Gotify POST /message (reply)
```

## Gotify API Notes

### Message API

- Create messages: `POST /message`
- Authentication: application token only (`X-Gotify-Key: <appToken>`)
- Token transport alternatives: query `token=...`, `Authorization: Bearer ...`
- Defaults: if `title` is empty, Gotify uses the application name; if `priority` is omitted, Gotify uses the application's default priority.

### WebSocket Stream API

- Endpoint: `GET /stream`
- Authentication: client token
- This plugin connects with query token: `/stream?token=<clientToken>`
- Server-side heartbeat uses ping/pong; origin validation may block cross-origin browsers depending on `AllowedWebSocketOrigins`.

### Application and Client API

- Applications (`/application`) and clients (`/client`) require client token authentication (application token cannot access these APIs).
- This plugin uses these APIs only for explicit bootstrap / doctor workflows.

### User API

User API is not required for normal send/receive workflows. Keep runtime least-privilege by using appToken for delivery and clientToken only when enabling inbound stream or running operator diagnostics.

## Quick Start

### Prerequisites

- OpenClaw `>= 2026.4.0`
- Node.js `22+`
- A running Gotify server

### Install

```bash
openclaw plugins install @partme.ai/openclaw-gotify
```

### Minimal Config

```json
{
  "channels": {
    "gotify": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "name": "default",
          "enabled": true,
          "serverUrl": "https://gotify.example.com",
          "appToken": "YOUR_GOTIFY_APP_TOKEN",
          "clientToken": "YOUR_GOTIFY_CLIENT_TOKEN",
          "defaultPriority": 5,
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "inbound": {
            "enabled": true,
            "allowedAppId": 1
          }
        }
      }
    }
  },
  "session": {
    "dmScope": "per-account-channel-peer"
  }
}
```

## Multi-Account Config

```json
{
  "channels": {
    "gotify": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "name": "default",
          "enabled": true,
          "serverUrl": "http://localhost:8080",
          "appToken": "ACYOShvtHHH2U69",
          "clientToken": "C7ErQjzzeoAXCKg",
          "defaultPriority": 5,
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "inbound": {
            "enabled": true
          }
        },
        "e2e": {
          "name": "e2e",
          "enabled": true,
          "serverUrl": "http://127.0.0.1:18080",
          "appToken": "Aiq5hUNRZLE9ucx",
          "clientToken": "CS8dXyptveo_dkm",
          "defaultPriority": 5,
          "dmPolicy": "open",
          "allowFrom": ["*"],
          "inbound": {
            "enabled": true,
            "allowedAppId": 2,
            "deleteAfterConsume": false
          }
        }
      }
    }
  }
}
```

This pattern makes the runtime intent explicit:

- `accounts.default` is the normal plugin account.
- `accounts.e2e` is a dedicated local test account.
- `appToken` is always the token used by `openclaw-gotify` itself for outbound send.
- `clientToken` is used by the plugin for `/stream` inbound listen and operator APIs.
- `inbound.allowedAppId` means one account only accepts inbound messages from one Gotify Application ID.

### Backlog Replay

When `inbound.enabled=true`, `openclaw-gotify` now requires `inbound.allowedAppId` and uses it for startup backlog replay:

1. connect `/stream` first and buffer newly arriving live messages
2. fetch historical messages from `GET /application/{allowedAppId}/message?since=<lastSeenMessageId>`
3. replay them one by one in ascending message-id order
4. persist `lastSeenMessageId` after each successfully processed message
5. drain buffered live messages in order
6. switch to normal live `/stream` handling

This design avoids sending a whole backlog batch to the agent at once. Each historical message is dispatched as an individual inbound turn.

For local end-to-end tests, the simulated external sender may use a second Gotify Application token such as `GOTIFY_SENDER_APP_TOKEN`. That sender token is a test harness concern and is not part of the plugin's runtime config shape.

## Session Isolation

`openclaw-gotify` does not define its own isolation model. All session partitioning follows OpenClaw `session.dmScope`.

Supported values:

- `main`
- `per-peer`
- `per-channel-peer`
- `per-account-channel-peer`

## Bootstrap and Doctor

Normal send only needs `appToken`. When you want setup automation, provide `clientToken` and run the test client or your own bootstrap wrapper.

```bash
GOTIFY_SERVER_URL=https://gotify.example.com \
GOTIFY_APP_TOKEN=app-token \
GOTIFY_CLIENT_TOKEN=client-token \
GOTIFY_BOOTSTRAP=true \
GOTIFY_BOOTSTRAP_CREATE=false \
npm run test:client
```

## Status Routes

- `GET /gotify/status`
- `GET /gotify/doctor`

Both routes are registered with `auth: plugin` in full mode.

## Testing

```bash
npm test
npm run test:client
```

Covered areas:

- config parsing
- dmScope session key derivation
- outbound account selection
- Message API request building
- bootstrap behavior
- WebSocket listener lifecycle

## GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | Push / PR to `main` or `master` | Install, typecheck, build, test, upload `dist` |
| `release.yml` | Push tag `v*` | Build, test, package, publish to npm, create GitHub release |

## Project Structure

```text
openclaw-gotify/
├── src/
│   ├── index.ts
│   ├── setup-entry.ts
│   ├── channel.ts
│   ├── config.ts
│   ├── peer-resolver.ts
│   ├── inbound-access.ts
│   ├── gotify-api.ts
│   ├── runtime.ts
│   ├── setup.ts
│   ├── ws-listener.ts
│   └── *.test.ts
├── scripts/
│   └── test-client.ts
├── .github/workflows/
├── openclaw.plugin.json
├── package.json
└── README.md / README.en.md
```

## FAQ

**Does this plugin require client token for every send?**

No. Standard outbound sending only uses the application token.

**Why keep bootstrap separate from normal runtime?**

Because Gotify client-level APIs are more privileged. `openclaw-gotify` keeps least privilege by default.

**Can WebSocket stream act like a two-way chat socket?**

Not directly. The plugin treats stream messages as inbound triggers and uses the normal OpenClaw reply pipeline plus Message API to answer.

## License

MIT
