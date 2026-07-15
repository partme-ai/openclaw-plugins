# OpenClaw OpenMem

OpenClaw 2026.7.1 的 OpenMem REST 记忆桥接插件。

[简体中文](./README.zh-CN.md) | [English](./README.md)

## 实际能力

- `session_start`：在 OpenMem 创建或恢复 ACTIVE session。
- `agent_end`：只上传当前轮消息；用 `runId + 消息序号` 生成稳定 `eventId`，可安全重试。
- `session_end`：提交 session，触发 OpenMem archive 和 externalized memory 生成。
- 自动/主动召回：实现 `MemorySearchManager` 和 `openmem_search`。
- 完整 HTTP 保护：请求超时、有限指数退避、响应体上限、JSON/Schema 校验、关闭时取消请求。
- 可选鉴权 Header：密钥只从环境变量读取，适合接入鉴权反向代理。

当前 OpenMem 的 hybrid recall 是 FTS5 + 字符 n-gram 重排，不是 embedding/vector 检索。本插件的能力探测会如实返回 vector 不可用。

## 安全默认

OpenMem 当前 keyword/hybrid 搜索是 sidecar 全局范围，没有 tenant filter。为避免跨会话泄漏，本插件默认：

- 只服务 `agentId: "main"`；其他 Agent 不获得 manager 和工具。
- `allowSharedRecall: false`，只召回同一 OpenClaw sessionKey 对应的上一条已归档 OpenMem session（continuity）。
- `baseUrl` 为非 loopback 地址时必须使用 HTTPS。

只有 sidecar 确认属于单一信任域时，才可启用 `allowSharedRecall: true` 使用全局 hybrid recall。

## 配置

```jsonc
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317",
          "agentId": "main",
          "required": false,
          "maxSearchResults": 10,
          "timeoutMs": 5000,
          "maxAttempts": 3,
          "retryBaseDelayMs": 100,
          "maxResponseBytes": 2097152,
          "allowSharedRecall": false,
          "apiKeyEnv": "OPENMEM_API_KEY",
          "authHeader": "Authorization",
          "authScheme": "Bearer"
        }
      }
    }
  }
}
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | `true` | 是否启用插件 |
| `required` | `false` | `true` 时 sidecar 启动不可用会阻止 Gateway 启动 |
| `baseUrl` | `http://127.0.0.1:3317` | OpenMem REST 地址；远端必须 HTTPS |
| `agentId` | `main` | 此 sidecar 唯一服务的 OpenClaw Agent |
| `maxSearchResults` | `10` | 搜索结果硬上限，最大 100 |
| `timeoutMs` | `5000` | 单次 HTTP 请求超时 |
| `maxAttempts` | `3` | 幂等请求最大尝试次数 |
| `retryBaseDelayMs` | `100` | 指数退避基础延迟 |
| `maxResponseBytes` | `2097152` | 单个响应体上限 |
| `allowSharedRecall` | `false` | 是否允许 sidecar 全局 hybrid recall |
| `apiKeyEnv` | 无 | API key 所在环境变量；插件不接受明文 key 配置 |
| `authHeader` | `Authorization` | 鉴权 Header 名 |
| `authScheme` | `Bearer` | Header scheme；空字符串表示直接发送 key |

## OpenMem 服务边界

当前工作区 OpenMem Server 没有内置请求鉴权，并且源码中的 `app.listen(PORT)` 没有显式限定监听地址。生产环境必须至少满足一项：

1. sidecar 仅在容器/主机 loopback 或私有网络可达，并由防火墙阻止外部访问；
2. 前置 mTLS/API-key 反向代理，并配置 `apiKeyEnv`；
3. 为 OpenMem Server 增加正式鉴权与明确的 bind host 后再开放网络。

插件不会把 `apiKeyEnv` 误描述成 OpenMem 原生鉴权；它只负责向前置保护层发送 Header。

## 验证

```bash
pnpm --filter @partme.ai/openclaw-openmem test
pnpm --filter @partme.ai/openclaw-openmem typecheck
pnpm --filter @partme.ai/openclaw-openmem build
```

真实 E2E 应覆盖：`healthz → sessions/start → events/ingest → sessions/:id/append → sessions/:id/commit → inspect/search`。
