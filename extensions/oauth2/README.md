# OpenClaw OAuth2

<!-- README_STANDARD_START -->

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's `doc/` design material.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 1. Component positioning

Acts as a standard OAuth2 client for an external identity service. Component type: **OAuth2/OIDC authorization proxy**.

| Item | Value |
|---|---|
| npm package | `@partme.ai/openclaw-oauth2` |
| Version | `2026.7.1` |
| Plugin ID | `oauth2` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| Source | `extensions/oauth2` |

## 2. At a glance

```text
[Browser or API requests to the Gateway]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Inside OpenClaw Gateway: oauth2
│ 1. Discover the external authorization server and create authorization requests
│ 2. Validate callback, tokens, and session state
│ 3. Inject trusted identity and reverse proxy
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[Requests authorized by external OAuth2/OIDC]
```

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

```text
Browser or API requests to the Gateway
  │
  ▼
Discover the external authorization server and create authorization requests
  │
  ▼
Validate callback, tokens, and session state
  │
  ▼
Inject trusted identity and reverse proxy
  │
  ▼
Requests authorized by external OAuth2/OIDC

Failure path: Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy
```

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | Acts as a standard OAuth2 client for an external identity service |
| Does not own | It is not an OAuth2 server and does not store user passwords |
| Input | Browser or API requests to the Gateway |
| Output | Requests authorized by external OAuth2/OIDC |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

```bash
openclaw plugins install "@partme.ai/openclaw-oauth2@2026.7.1"
```

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | `plugins.entries.oauth2.config` |
| Channel configuration | Not applicable |
| Configuration schema | `extensions/oauth2/openclaw.plugin.json` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

```bash
pnpm --filter "@partme.ai/openclaw-oauth2" typecheck
pnpm --filter "@partme.ai/openclaw-oauth2" test
pnpm --filter "@partme.ai/openclaw-oauth2" build
```

- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

<!-- README_STANDARD_END -->


Standards-based OAuth2/OIDC client authentication proxy for OpenClaw, powered by [`openid-client`](https://github.com/panva/openid-client).

The plugin runs an HTTP/WebSocket reverse proxy in front of the OpenClaw Gateway. It handles Authorization Code + PKCE, sessions, refresh, revocation, UserInfo or introspection, and injects verified identity into OpenClaw trusted-proxy headers.

## Discovery configuration

```json
{
  "enabled": true,
  "issuerUrl": "https://auth.example.com/",
  "clientId": "openclaw-gateway",
  "clientSecret": "replace-with-secret",
  "client": {
    "discovery": true,
    "redirectUri": "https://gateway.example.com/auth/oauth2/callback",
    "scopes": ["openid", "profile"],
    "requiredScopes": ["openclaw:operator"],
    "clientAuthMethod": "client_secret_post",
    "authorizationParameters": {
      "audience": "openclaw-api"
    },
    "sessionSecret": "replace-with-at-least-32-random-characters",
    "secureCookies": true,
    "userIdField": "sub"
  },
  "proxy": {
    "listenHost": "0.0.0.0",
    "listenPort": 18080,
    "upstreamHost": "127.0.0.1",
    "upstreamPort": 18789,
    "forwardedProto": "https"
  }
}
```

## Explicit endpoint configuration

Set `client.discovery=false` when the authorization server does not publish metadata. Configure at least `authorizationEndpoint` and `tokenEndpoint`; UserInfo, introspection, and revocation are optional standard capabilities.

```json
{
  "enabled": true,
  "issuerUrl": "https://auth.example.com/",
  "clientId": "openclaw-gateway",
  "clientSecret": "replace-with-secret",
  "client": {
    "discovery": false,
    "redirectUri": "https://gateway.example.com/auth/oauth2/callback",
    "authorizationEndpoint": "https://auth.example.com/oauth2/authorize",
    "tokenEndpoint": "https://auth.example.com/oauth2/token",
    "userInfoEndpoint": "https://auth.example.com/oauth2/userinfo",
    "introspectionEndpoint": "https://auth.example.com/oauth2/introspect",
    "revokeEndpoint": "https://auth.example.com/oauth2/revoke",
    "clientAuthMethod": "client_secret_basic",
    "authorizationParameters": {},
    "tokenParameters": {},
    "sessionSecret": "replace-with-at-least-32-random-characters"
  }
}
```

The authenticated identity can come from ID Token claims, UserInfo, or introspection. Bearer API requests require UserInfo or introspection.

## Local endpoints

- `GET /auth/oauth2/login`
- `GET /auth/oauth2/callback`
- `POST /auth/oauth2/logout`
- `/auth/oauth2/status` is forwarded to OpenClaw's `auth: "gateway"` route
- `GET/HEAD /health`

`requiredScopes` gates access at the OAuth2 proxy. OAuth scopes are not translated into OpenClaw operator scopes; configure OpenClaw trusted-proxy and `allowUsers` for Gateway authorization. For production, use HTTPS, secure cookies, bounded sessions, and Redis-backed sessions for multiple proxy instances.

## OpenClaw trusted-proxy requirement

The Gateway must remain loopback-only and trust exactly the identity header emitted by this plugin:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback",
    "trustedProxies": ["127.0.0.1"],
    "auth": {
      "mode": "trusted-proxy",
      "trustedProxy": {
        "userHeader": "x-forwarded-user",
        "allowLoopback": true,
        "allowUsers": ["allowed-user-id"]
      }
    }
  }
}
```

The plugin validates auth mode, identity header, loopback trust, trusted proxy address, and Gateway port before opening its listener. `proxy.upstreamHost` only accepts `127.0.0.1` or `::1`.

## Verification

```bash
pnpm --dir extensions/oauth2 test
pnpm --dir extensions/oauth2 typecheck
pnpm --dir extensions/oauth2 build
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs --plugins oauth2
```
