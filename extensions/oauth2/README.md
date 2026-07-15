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
    "upstreamPort": 18789
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

- `/auth/oauth2/login`
- `/auth/oauth2/callback`
- `/auth/oauth2/logout`
- `/auth/oauth2/status`
- `/health`

For production, use HTTPS, secure cookies, strict scopes, and Redis-backed sessions for multiple proxy instances.
