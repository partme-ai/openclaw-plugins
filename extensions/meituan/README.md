# @partme.ai/openclaw-meituan

<!-- README_STANDARD_START -->

> Standard reading order: positioning → architecture → flow → boundaries → installation → configuration → operations → deep dive.
> This block favors text diagrams that render reliably on npm; when applicable, deeper Mermaid diagrams remain in the repository's `doc/` design material.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 1. Component positioning

Wraps explicitly approved Meituan technical-service APIs. Component type: **Capability tool**.

| Item | Value |
|---|---|
| npm package | `@partme.ai/openclaw-meituan` |
| Version | `2026.7.1` |
| Plugin ID | `meituan` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| Source | `extensions/meituan` |

## 2. At a glance

```text
[Agent Meituan business request]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Inside OpenClaw Gateway: meituan
│ 1. Validate operation allowlist, confirmation, and input
│ 2. Sign and call MTOp OpenAPI
│ 3. Apply retry boundaries and sanitize responses
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[Controlled business API results]
```

## 3. Architecture and core flow

The component keeps protocol and platform differences inside its own boundary and exposes stable plugin, channel, hook, tool, or service contracts to OpenClaw.

```text
Agent Meituan business request
  │
  ▼
Validate operation allowlist, confirmation, and input
  │
  ▼
Sign and call MTOp OpenAPI
  │
  ▼
Apply retry boundaries and sanitize responses
  │
  ▼
Controlled business API results

Failure path: Any failed stage: record a diagnosable error, then retry, reject, or degrade per component policy
```

## 4. Capabilities and boundaries

| Area | Contract |
|---|---|
| Owns | Wraps explicitly approved Meituan technical-service APIs |
| Does not own | Does not provide arbitrary MTOp passthrough or replace business authorization |
| Input | Agent Meituan business request |
| Output | Controlled business API results |
| Failure rule | Failures remain observable; authentication, boundary validation, and persistence failures must not be reported as success |

## 5. Quick start

```bash
openclaw plugins install "@partme.ai/openclaw-meituan@2026.7.1"
```

Start with least-privilege configuration, then launch the Gateway. Validate connectivity, authorization, and recovery in an isolated profile before production use.

## 6. Configuration entry points

| Layer | Path |
|---|---|
| Plugin configuration | `plugins.entries.meituan.config` |
| Channel configuration | Not applicable |
| Configuration schema | `extensions/meituan/openclaw.plugin.json` |

Field definitions, environment variables, and complete examples remain in the preserved detailed reference below.

## 7. Operations, security, and troubleshooting

- Confirm the OpenClaw version, package version, manifest ID, and configuration key first.
- Keep credentials in environment variables or SecretRef values, never in logs, source control, or plaintext examples.
- Diagnose by layer: Gateway logs, plugin health, then the external dependency.
- Back up state before upgrades; for cursors, queues, or indexes, verify restart recovery and duplicate-delivery semantics.

## 8. Verification and deep dives

```bash
pnpm --filter "@partme.ai/openclaw-meituan" typecheck
pnpm --filter "@partme.ai/openclaw-meituan" test
pnpm --filter "@partme.ai/openclaw-meituan" build
```

- [Plugin architecture overview](../../doc/OpenClaw-Plugins-Architecture.md)
- [Unified plugin structure standard](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. Preserved detailed reference

The original configuration tables, protocol details, examples, and troubleshooting material continue below.

<!-- README_STANDARD_END -->


Meituan MTOp OpenAPI capability for OpenClaw 2026.7.1. This package is not a chat channel. It invokes only operations explicitly allowlisted from your Meituan application documentation.

## What it implements

- The form-encoded request contract used by the official `MtOpJavaSDK`.
- SHA-1 signing over `signKey + sorted(key + value)`.
- Configured API path and `businessId` allowlists.
- Owner-only access by default, concurrency/rate limits, timeout, and body limits.
- Per-operation `read` / `write` risk classification; writes require `confirm=true` every time.
- Standard business-code validation (`OP_SUCCESS` by default).
- Trusted `agentAccountId` to shop-token binding for multi-shop deployments.
- Separate upstream-response and Agent Tool-result size limits.
- Bounded retries for read operations on network errors and HTTP 408/429/5xx; writes are never retried.
- Required-by-default write idempotency field with a bounded process-local TTL ledger.
- Manual redirect handling so a signed form and shop token are not automatically forwarded to another origin.

```text
Owner / OpenClaw Agent
          │ operation + biz + confirm?
          ▼
meituan_openapi_invoke
          │
          ├─ ownerOnly / operation allowlist / read-write risk gate
          ├─ trusted agentAccountId → one shop token
          └─ write requires confirm=true + idempotency value
                         │
                         ▼
             bounded biz JSON + MTOp form
                         │
                         ▼
       concurrency → SHA-1 signature → rate/idempotency limits
                         │
              ┌──────────┴──────────┐
              │ read: bounded retry │ write: one attempt
              │ backoff + jitter    │ retain TTL claim
              └──────────┬──────────┘
                         ▼
               Meituan MTOp OpenAPI
                         │
                         ▼
 bounded response → successCodes → credential/error redaction
                         │
                         ▼
              bounded Tool Result → Agent
```

```mermaid
flowchart LR
    A["Owner / OpenClaw Agent"] --> T["meituan_openapi_invoke"]
    T --> B["Trusted agentAccountId → shop token"]
    B --> G["Owner + operation allowlist + risk confirmation"]
    G --> F["Bounded form + write idempotency check"]
    F --> L["Concurrency + per-process rate limit"]
    L --> Q{"Operation risk"}
    Q -->|read transient failure| P["Bounded backoff retry"] --> M["Meituan MTOp OpenAPI"]
    Q -->|write or first read attempt| M
    M --> V["Bounded JSON + success-code validation"]
    V --> R["Bounded Agent Tool Result"] --> A
```

MTOp uses POST for both business reads and writes. Verified `read` operations retry only network failures and HTTP 408/429/5xx with bounded backoff; business failures are not retried. A `write` is always sent once and must declare a top-level `idempotencyBizField` by default. Unknown config fields fail closed, every security boolean is type-strict, oversized response streams are cancelled, and a non-official remote origin requires explicit `allowCustomApiBaseUrl=true` acknowledgement.

`confirm=true` is a technical guard against accidental model invocation, not a substitute for business approval, financial controls, or human review. Refund, redemption, fulfilment, and similar high-risk operations should remain behind an upstream approval workflow or should not be exposed to a general Agent.

The TTL idempotency ledger is process-local and per account client. Multi-Gateway or financial workflows still require a shared business idempotency store or a server-side idempotency contract.

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

Write operation example: `{ "name": "refund", "apiPath": "/approved/path", "businessId": 1, "riskLevel": "write", "idempotencyBizField": "orderId" }`. `requireWriteIdempotency=false` is an explicit legacy escape hatch and weakens duplicate protection.

See [README.zh-CN.md](./README.zh-CN.md) for the complete production checklist. Public platform entry: <https://openapi.meituan.com/>.

Installed-plugin Agent Tool E2E:

```bash
OPENCLAW_E2E_HOST_GATEWAY=1 pnpm test:e2e -- --plugins meituan --skip-browser
```
