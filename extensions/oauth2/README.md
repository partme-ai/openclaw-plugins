<div align="center">

# OpenClaw OAuth2

**OAuth 2.0 authentication backend — Sa-Token · JWT · Introspection**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

[中文](README.zh-CN.md) | English

---

> **Status**: Implemented — OIDC Discovery, JWKS caching, JWT RS256 validation, Token Introspection, Scope-Role mapping, and global Bearer Token middleware are all complete.

Inspired by [rabbitmq_auth_backend_oauth2](https://www.rabbitmq.com/docs/oauth2), adapted for [Sa-Token OAuth2](https://sa-token.cc/doc.html#/oauth2/readme).

## Overview


Key features:

- **OIDC Discovery**: Auto-configure from `/.well-known/openid-configuration`
- **JWKS Caching**: Automatic JWKS refresh with configurable TTL (default 1 hour), forced refresh on kid miss
- **JWT Validation**: RS256 signature verification, `exp`/`iss`/`aud` claim validation, Sa-Token custom claims extraction
- **Token Introspection**: Fallback for opaque UUID tokens via `/oauth2/check_token` (RFC 7662), short TTL cache (30s)
- **Scope-to-Role Mapping**: `openclaw:admin` → admin, `openclaw:operator` → operator, `openclaw:viewer` → viewer
- **Global Middleware**: Injects `AuthContext` into all requests for downstream plugins

## Architecture

```
Client (Business backend / API call)
  │
  ├── Authorization: Bearer <JWT>          ← Primary path (zero network overhead)
  ├── Authorization: Bearer <UUID Token>   ← Fallback path (one HTTP call)
  │
  ▼
┌──────────────────────────────────────────────┐
│  openclaw-oauth2 middleware              │
│                                              │
│  1. Extract Bearer Token                     │
│  2. Detect token format (JWT 3-part / UUID)  │
│     ├── JWT → Local validation (JWKS + RS256)│
│     │         ├── Success → Extract claims   │
│     │         └── Failure → Introspection    │
│     └── UUID → Token Introspection           │
│               └── POST /oauth2/check_token   │
│  3. Parse Sa-Token claims                    │
│     ├── loginId / tenantId / loginType       │
│     └── scope → Role mapping                 │
│  4. Inject AuthContext → req.authContext      │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
         (reads req.authContext for authorization)
```

## Authentication Strategy

| Step | Token Type | Validation | Network Cost |
|------|-----------|------------|-------------|
| 1 | JWT (3-part base64url) | Local RS256 signature | **Zero** |
| 2 | JWT validation fails | Fallback to Introspection | 1 HTTP call |
| 3 | UUID opaque token | Direct Introspection | 1 HTTP call |

## Configuration

```json
{
  "plugins": {
    "openclaw-oauth2": {
      "issuerUrl": "https://api.example.com",
      "clientId": "openclaw-gateway",
      "clientSecret": "your-client-secret",
      "audience": "openclaw-api",
      "scopeMapping": {
        "openclaw:admin": "admin",
        "openclaw:operator": "operator",
        "openclaw:viewer": "viewer"
      },
      "satoken": {
        "loginIdClaim": "loginId",
        "tenantIdClaim": "tenantId",
        "loginTypeClaim": "loginType"
      },
      "publicPaths": ["/health", "/auth/oauth2/status"],
      "jwksRefreshInterval": 3600000,
      "introspectionCacheTtl": 30000
    }
  }
} 
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `issuerUrl` | string | — | Sa-Token OAuth2 Server URL (required) |
| `clientId` | string | — | OAuth2 Client ID |
| `clientSecret` | string | — | OAuth2 Client Secret |
| `audience` | string | — | JWT aud validation value (optional) |
| `scopeMapping` | object | see above | Scope → Role mapping |
| `satoken.loginIdClaim` | string | `loginId` | JWT claim for user ID |
| `satoken.tenantIdClaim` | string | `tenantId` | JWT claim for tenant ID |
| `publicPaths` | string[] | `["/health"]` | Paths exempt from auth |
| `jwksRefreshInterval` | number | `3600000` | JWKS refresh interval (ms) |
| `introspectionCacheTtl` | number | `30000` | Introspection cache TTL (ms) |

## HTTP Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/auth/oauth2/status` | GET | Plugin status (enabled, provider info) |

## Directory Structure

```
openclaw-oauth2/
  src/
    index.ts                    # Entry: init + register middleware
    types.ts                    # AuthContext, SaTokenClaims, etc.
    middleware.ts               # Global Bearer Token middleware
    satoken-discovery.ts        # OIDC Discovery + JWKS fetch/cache
    satoken-jwt.ts              # JWT RS256 local validation
    satoken-introspection.ts    # Token Introspection (UUID fallback)
    satoken-scope-mapper.ts     # Scope → Role/Permission mapping
    satoken-scope-mapper.test.ts
    satoken-jwt.test.ts
```

## Implementation Status

- [x] OIDC Discovery (auto-fetch JWKS URI, issuer, etc.)
- [x] JWKS public key fetching, caching and periodic refresh
- [x] JWT RS256 signature validation
- [x] Sa-Token claims extraction (loginId, tenantId, loginType)
- [x] Opaque Token Introspection (RFC 7662)
- [x] Scope → Role/Permission mapping
- [x] Global Bearer Token middleware
- [x] AuthContext injection
- [ ] Token refresh flow (Business backend responsibility)
- [ ] Multi-provider support

## Testing

```bash
pnpm test            # run unit tests
pnpm test:watch      # watch mode
pnpm test:coverage   # coverage report
```

Test coverage:
- `satoken-scope-mapper.test.ts` — Scope→Role mapping, priority, custom config (14 tests)
- `satoken-jwt.test.ts` — JWT format detection (6 tests)

## Development

```bash
pnpm install
pnpm build
pnpm dev   # watch mode
```

## Related OpenClaw plugins

| Plugin | Description |
|--------|--------------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 authentication |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | Cluster coordination (discovery, config sync, session store, proxy) |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT protocol adapter |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus metrics exporter |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP server |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | Distributed tracing |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |

## License

MIT
