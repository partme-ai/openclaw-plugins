# @partme.ai/openclaw-meituan

Meituan MTOp OpenAPI capability for OpenClaw 2026.7.1. This package is not a chat channel. It invokes only operations explicitly allowlisted from your Meituan application documentation.

## What it implements

- The form-encoded request contract used by the official `MtOpJavaSDK`.
- SHA-1 signing over `signKey + sorted(key + value)`.
- Configured API path and `businessId` allowlists.
- Owner-only access by default, request rate limiting, timeout, and body limits.
- No automatic POST retry, which prevents accidental duplicate write operations.

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
          "operations": [
            {
              "name": "receipt_query",
              "apiPath": "/path-copied-from-meituan-docs",
              "businessId": 1,
              "requiresAuth": true
            }
          ]
        }
      }
    }
  }
}
```

Credentials may instead be provided through `MEITUAN_DEVELOPER_ID`, `MEITUAN_SIGN_KEY`, and `MEITUAN_APP_AUTH_TOKEN`. The default endpoint is `https://api-open-cater.meituan.com`.

The plugin registers `meituan_openapi_invoke` with `{ operation, biz }`. Both the operation definition and its `biz` fields must come from the documentation available for your approved Meituan business integration.

See [README.zh-CN.md](./README.zh-CN.md) for the complete production checklist. Public platform entry: <https://openapi.meituan.com/>.
