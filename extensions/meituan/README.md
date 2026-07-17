# @partme.ai/openclaw-meituan

Meituan MTOp OpenAPI capability for OpenClaw 2026.7.1. This package is not a chat channel. It invokes only operations explicitly allowlisted from your Meituan application documentation.

## What it implements

- The form-encoded request contract used by the official `MtOpJavaSDK`.
- SHA-1 signing over `signKey + sorted(key + value)`.
- Configured API path and `businessId` allowlists.
- Owner-only access by default, request rate limiting, timeout, and body limits.
- Per-operation `read` / `write` risk classification; writes require `confirm=true` every time.
- Standard business-code validation (`OP_SUCCESS` by default).
- Trusted `agentAccountId` to shop-token binding for multi-shop deployments.
- Separate upstream-response and Agent Tool-result size limits.
- No automatic POST retry, which prevents accidental duplicate write operations.

```mermaid
flowchart LR
    A["Owner / OpenClaw Agent"] --> T["meituan_openapi_invoke"]
    T --> B["Trusted agentAccountId → shop token"]
    B --> G["Owner + operation allowlist + risk confirmation"]
    G --> F["Bounded MTOp form + SHA-1 signature"]
    F --> L["Per-process rate limit"]
    L --> M["Meituan MTOp OpenAPI"]
    M --> V["Bounded JSON + success-code validation"]
    V --> R["Bounded Agent Tool Result"] --> A
```

Every MTOp invocation is a single POST. The plugin does not retry network, HTTP, or business failures because the operation may be non-idempotent and the platform does not provide a generic idempotency key. Unknown config fields fail closed, every security boolean is type-strict, oversized response streams are cancelled, and a non-official remote origin requires explicit `allowCustomApiBaseUrl=true` acknowledgement.

When `accounts` are configured, credentials are selected only from the runtime-trusted `agentAccountId`; the model cannot provide an account selector. `requireAccountBinding` defaults to true in this mode. Operations with `requiresAuth=false` never receive a shop token.

## Configuration

```json
{
  "plugins": {
    "entries": {
      "meituan": {
        "enabled": true,
        "config": {
          "enabled": true,
          "developerId": "123456",
          "signKey": "secret",
          "appAuthToken": "authorized-shop-token",
          "maxToolResultBytes": 262144,
          "operations": [
            {
              "name": "receipt_query",
              "apiPath": "/path-copied-from-meituan-docs",
              "businessId": 1,
              "requiresAuth": true,
              "riskLevel": "read",
              "successCodes": ["OP_SUCCESS"]
            }
          ]
        }
      }
    }
  }
}
```

For multiple shops, prefer environment-backed bindings:

```json
{
  "accounts": [
    { "accountId": "shop-a", "appAuthTokenEnv": "MEITUAN_SHOP_A_TOKEN" },
    { "accountId": "shop-b", "appAuthTokenEnv": "MEITUAN_SHOP_B_TOKEN" }
  ],
  "requireAccountBinding": true
}
```

Credentials may instead be provided through `MEITUAN_DEVELOPER_ID`, `MEITUAN_SIGN_KEY`, and `MEITUAN_APP_AUTH_TOKEN`. The default endpoint is `https://api-open-cater.meituan.com`.

The plugin registers `meituan_openapi_invoke` with `{ operation, biz, confirm? }`. Both the operation definition and its `biz` fields must come from the documentation available for your approved Meituan business integration. Operations default to `riskLevel: "write"`; explicitly mark verified read-only APIs as `read`.

See [README.zh-CN.md](./README.zh-CN.md) for the complete production checklist. Public platform entry: <https://openapi.meituan.com/>.

Installed-plugin Agent Tool E2E:

```bash
OPENCLAW_E2E_HOST_GATEWAY=1 pnpm test:e2e -- --plugins meituan --skip-browser
```
