# U3 Tracing 跨 runtime 查询验收记录

日期：2026-09-29。宿主：OpenClaw 2026.9.6（eb377ac）。本记录只覆盖 Tracing 查询链路；不代表整个 U3 已验收。

## 包与本地验证

- 三次独立 profile 安装同一构建包，SHA-256：`3c1ca02f9fa3e0cc0c4f3666f884fbfa1d6fe5cd75d1ed0591bd5ee4ab7bbdfc`。随后增加 journal 原始标识符脱敏，最终包 SHA-256：`cbd9d8569f7d41d7479751cedbdc983ffb30f6e9b6a3c01c2fb86e6cc2dbf0c3`，再次使用独立 profile 验证 Collector、list/detail、重启与匿名拒绝；跨 profile 404 证据仍来自前一个包。
- `pnpm --dir extensions/tracing test`：73/73 通过。
- `pnpm --dir extensions/tracing typecheck`：通过。
- `pnpm --dir extensions/tracing build`：通过；构建门禁检查最终 `dist/index.js` 保留 `node:sqlite` 导入。
- `git diff --check`：通过。

## 隔离宿主结果

三套 profile 均完成真实 Agent turn（退出码 0），Collector 各收到一个 `agent.run` Span。各自的 Gateway `GET /tracing/traces` 与 `GET /tracing/trace` 返回与 Collector 相同的 traceId；重启 Gateway 后 status 为 `active`、backend 为 `otlp`，list/detail 仍可查到同一 traceId。匿名 GET 返回 401。

最终包的再次验证：Agent 退出码 0；Collector、list、detail、重启后的 list/detail 均匹配 traceId `01a24446ece7e518043d0f6903a10a86`，重启 status 为 `active/otlp`，匿名 GET 返回 401。

| Profile | Collector、list、detail、重启后的 traceId | 查询另一 profile 的 ID |
|---|---|---|
| A | `c8e2d430c089219ff82f107615a3fb48` | — |
| B | `bfcd4ec8bf89efc69e91980fe8aa26c6` | 列表中不含 A |
| C | `f144ae6e3ea755f39aa6e94ed7fb0779` | 指定 A 的 ID 返回 404 |

查询 journal 位于各自的 OpenClaw profile 状态目录；宿主文件权限检查为目录 `0700`、数据库 `0600`。`queryHealth` 仅表示数据库可读，`completeness: "unverified"` 不表示每个完成的 Span 均已保留；隔离 Hook runtime 的导出健康仍需以该 runtime 日志及 Collector 结果验证。

## 仍待 U3 验收

- 真实 Gateway 签发的只读浏览器 grant 对管理 GET 的授权，以及该 grant 对 Router `POST /router/dlq/replay` 的拒绝。
- 过期凭据对 Router replay POST 的拒绝与无重放副作用。
- Router 管理端点的完整合法授权、异常凭据和副作用验收；本报告不覆盖 Router。
