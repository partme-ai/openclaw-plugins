# @partme.ai/openclaw-rednode

Allowlisted RED Ark Open API capability for OpenClaw 2026.7.1. It is not a messaging, content-publishing, or browser-automation channel.

The client follows the official Ark contract: JSON requests, `timestamp` / `app-key` / `sign` headers, and MD5 of the API path plus sorted query/header parameters plus app-secret. Production uses `https://ark.xiaohongshu.com`; the explicitly selected sandbox uses `http://flssandbox.xiaohongshu.com`.

Configure `appKey`, `appSecret`, and one or more `{ name, method, apiPath }` operations under `plugins.entries.rednode.config`. Credentials can instead use `XHS_APP_KEY` and `XHS_APP_SECRET`. The plugin registers only `rednode_ark_invoke`; POST and PUT calls require `confirm: true`.

See [README.zh-CN.md](./README.zh-CN.md) and the official [request signing example](https://school.xiaohongshu.com/en/open/quick-start/sign.html).
