# OpenClaw OAuth2

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
