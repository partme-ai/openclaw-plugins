# @partme.ai/openclaw-rednode

Allowlisted RED Ark Open API capability for OpenClaw 2026.7.1. It is not a messaging, content-publishing, or browser-automation channel.

The client follows the official Ark contract: JSON requests, `timestamp` / `app-key` / `sign` headers, and MD5 of the API path plus sorted query/header parameters plus app-secret. Production uses `https://ark.xiaohongshu.com`; the explicitly selected sandbox uses `http://flssandbox.xiaohongshu.com`.

The text diagram remains useful in terminals, code review, and raw Markdown; the Mermaid diagram below is retained for rendered component relationships.

```text
┌───────────────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway 2026.7.1                       │
├───────────────────────────────────────────────────────────────────┤
│ Owner / Agent                                                     │
│      │ operation + path/query/body                                │
│      ▼                                                            │
│ rednode_ark_invoke                                                │
│      │ ownerOnly → operation allowlist → write confirmation       │
│      ▼                                                            │
│ RednodeClient                                                     │
│      │ input bounds → concurrency gate → rate limit → signature  │
│      │ manual redirect policy keeps auth headers on trusted host │
│      │ GET bounded retry; POST/PUT exactly once                   │
│      ▼                                                            │
│ response bound → success:Boolean → redaction → Tool result bound  │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
                     RED Ark Open API
```

```mermaid
flowchart LR
    A["Owner / OpenClaw Agent"] --> T["rednode_ark_invoke"]
    T --> G["Owner + operation allowlist + write confirmation"]
    G --> S["Ark path/query/header signature"]
    S --> C["Bounded concurrency"]
    C --> L["Per-process rate limit"]
    L --> X["RED Ark Open API"]
    X --> R["Bounded JSON + strict success:Boolean"]
    R --> B["Bounded Agent Tool Result"] --> A
```

Only idempotent GET calls retry network failures and the officially documented HTTP 500/502 responses, using bounded exponential backoff with jitter. POST and PUT execute once because Ark does not expose a server idempotency key. HTTP success still requires a JSON object with a Boolean `success` field. Unknown fields, non-object roots, control characters, non-finite path/query numbers, and non-boolean security switches fail closed. A non-official remote origin requires explicit `allowCustomApiBaseUrl=true` acknowledgement, and upstream responses and Agent Tool Results have separate byte limits. Fetch redirects are manual so signed authentication headers are never automatically forwarded to a 3xx target. Both the client boundary and final Tool boundary redact URL userinfo, Bearer/auth/sign fields, and the configured AppKey/AppSecret.

Configure `appKey`, `appSecret`, and one or more `{ name, method, apiPath }` operations under `plugins.entries.rednode.config`. Credentials can instead use `XHS_APP_KEY` and `XHS_APP_SECRET`. `maxConcurrentRequests` defaults to 8 and fails fast at capacity; `maxRequestsPerMinute` remains a per-process attempt limit. `RednodeClient.status()` exposes sanitized counters only for its own execution process; it is deliberately not presented as Gateway-global state because OpenClaw CLI Agents may execute tools in separate processes. Production-wide metrics and quotas require a shared metrics or egress-rate-limit backend. POST and PUT calls require `confirm: true`. Confirmation is only a technical accidental-invocation guard, not platform moderation, business approval, compliance review, or human authorization. This is an Ark merchant API tool, not a messaging/Webhook channel or an OAuth client.

Run the installed-artifact contract with `node scripts/e2e/run-e2e.mjs --plugins rednode --skip-browser`. It packs and installs the plugin into an isolated OpenClaw 2026.7.1 profile, performs a real Agent Tool round trip, independently verifies the Ark MD5 signature, forces one safe GET retry, and checks that the Tool Result returns to the model transcript.

See [README.zh-CN.md](./README.zh-CN.md) and the official [request signing example](https://school.xiaohongshu.com/en/open/quick-start/sign.html).
