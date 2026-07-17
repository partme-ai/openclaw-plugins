# OpenClaw AMap 中文说明

<!-- README_STANDARD_START -->

> 统一阅读顺序：组件定位 → 架构 → 流程 → 边界 → 安装 → 配置 → 运维 → 深入阅读。
> 本区块以 npm 可稳定渲染的 text 图为主；适用时，更深入的 Mermaid 图保留在仓库 `doc/` 设计资料中。

[简体中文](./README.md)

## 1. 组件定位

提供有界、可审计的地点搜索能力。组件类型：**业务能力 Tool**。

| 项目 | 内容 |
|---|---|
| npm 包 | `@partme.ai/openclaw-amap` |
| 当前版本 | `2026.7.1` |
| 插件 ID | `amap` |
| Channel ID | — |
| OpenClaw | `>=2026.7.1` |
| 源码目录 | `extensions/amap` |

## 2. 一眼看懂

```text
[Agent 地点检索请求]
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│ OpenClaw Gateway 内: amap
│ 1. 校验白名单操作与参数
│ 2. 签名并调用高德 Web API
│ 3. 限制并清洗 Tool Result
└──────────────────────────────────────────────────────────────┘
          │
          ▼
[结构化地点结果]
```

## 3. 架构与核心流程

该组件把“协议/平台差异”限制在自身边界内，对 OpenClaw 暴露稳定的插件、Channel、Hook、Tool 或 Service 契约。

```text
Agent 地点检索请求
  │
  ▼
校验白名单操作与参数
  │
  ▼
签名并调用高德 Web API
  │
  ▼
限制并清洗 Tool Result
  │
  ▼
结构化地点结果

异常路径: 任一步失败：记录可诊断错误并按组件策略重试、拒绝或降级
```

## 4. 能力与边界

| 能力 | 说明 |
|---|---|
| 负责 | 提供有界、可审计的地点搜索能力 |
| 不负责 | 不是地图 Channel，也不代理任意高德 API |
| 输入 | Agent 地点检索请求 |
| 输出 | 结构化地点结果 |
| 失败原则 | 默认失败应可观测；鉴权、边界校验和持久化失败不得伪装成功 |

## 5. 快速开始

```bash
openclaw plugins install "@partme.ai/openclaw-amap@2026.7.1"
```

安装后先按最小权限配置，再启动 Gateway；生产环境应在隔离配置目录中完成连通性、权限和失败恢复验证。

## 6. 配置入口

| 配置层 | 路径 |
|---|---|
| 插件配置 | `plugins.entries.amap.config` |
| Channel 配置 | 不适用 |
| 配置 Schema | `extensions/amap/openclaw.plugin.json` |

配置字段、环境变量与完整示例继续保留在下方原有详细说明中。

## 7. 运维、安全与故障定位

- 先确认 OpenClaw 版本、插件版本、manifest ID 与配置键一致。
- 凭据使用环境变量或 SecretRef，不写入日志、仓库和示例明文。
- 通过 Gateway 日志、插件健康状态及外部依赖状态分层定位问题。
- 升级前备份状态数据；涉及游标、队列或索引时，必须验证重启恢复与重复投递语义。

## 8. 验证与深入阅读

```bash
pnpm --filter "@partme.ai/openclaw-amap" typecheck
pnpm --filter "@partme.ai/openclaw-amap" test
pnpm --filter "@partme.ai/openclaw-amap" build
```

- [插件总体架构](../../doc/OpenClaw-Plugins-Architecture_CN.md)
- [统一插件结构规范](../../doc/OpenClaw-Plugins-Structure-Standard.md)

## 9. 原有详细说明

以下内容保留该组件原有的配置表、协议细节、示例和故障排查资料。

<!-- README_STANDARD_END -->


`@partme.ai/openclaw-amap` 是适配 OpenClaw 2026.7.1 的高德 Web 服务工具插件。它向 Agent 提供地点搜索能力，不是聊天渠道，也不会注册 Webhook 或伪造消息发送能力。

完整参数和接口依据见同目录 [README.md](./README.md)，本页重点说明插件在系统中的位置、边界和上线检查方式。

## 架构与调用链

```text
用户地点问题
     │
     ▼
OpenClaw Agent
     │ 结构化 Tool Call
     ▼
AMap Tool 参数边界 ── ownerOnly / 坐标 / POI 类型 / 200 条分页上限
     │
     ▼
AmapClient ── 并发闸门 / 固定三条 GET 白名单 / 每次尝试计入限流
     │
     ├── 可选 privateKey → 参数排序 → MD5 sig（私钥不出进程）
     ├── 429、5xx、QPS/网关瞬时错误 → 指数退避 + 双向抖动 → 有限重试
     │
     ▼
https://restapi.amap.com（Key/sig 仅在传输层，3xx 不跟随）
     │
     ▼
响应流字节上限 → JSON/status 信封校验 → 错误凭据脱敏
     │
     ▼
Tool Result 字节上限 → Agent transcript
```

```mermaid
flowchart LR
    U["用户提出地点问题"] --> A["OpenClaw Agent"]
    A --> T["AMap Tools<br/>参数 Schema 与 ownerOnly 校验"]
    T --> C["AmapClient<br/>并发闸门、按尝试限流、有限重试"]
    C --> S["可选数字签名<br/>排序参数 + privateKey → MD5 sig"]
    S -->|"HTTPS + Key/sig；redirect=manual"| API["高德 Web 服务 API"]
    API --> C --> B["maxResponseBytes<br/>保护进程内存"]
    B --> T --> R["maxToolResultBytes<br/>保护模型上下文"] --> A

    classDef runtime fill:#e3f2fd,stroke:#1565c0,color:#0d315c
    classDef plugin fill:#e8f5e9,stroke:#2e7d32,color:#123d17
    classDef external fill:#fff3e0,stroke:#ef6c00,color:#4e2600
    class A runtime
    class T,C,B,R plugin
    class API external
```

插件只负责把结构化工具调用转换成高德 HTTP 请求。对话上下文、工具选择和结果表达由 OpenClaw Agent 负责；Key 配额与高德数据质量由外部服务负责。

## 提供的工具

- `amap_search_places`：地点关键词搜索，对应 `/v5/place/text`。
- `amap_search_nearby`：指定经纬度的周边搜索，对应 `/v5/place/around`。
- `amap_place_detail`：根据 POI ID 查询详情，对应 `/v5/place/detail`。

## 最小配置

```json
{
  "plugins": {
    "entries": {
      "amap": {
        "enabled": true,
        "config": {
          "enabled": true,
          "requestTimeoutMs": 8000,
          "retryAttempts": 1,
          "maxResponseBytes": 1048576,
          "maxToolResultBytes": 262144,
          "maxRequestsPerMinute": 120,
          "maxConcurrentRequests": 8,
          "ownerOnly": false
        }
      }
    }
  }
}
```

生产环境优先通过 `AMAP_WEB_SERVICE_KEY` 注入 Key。如果该 Key 在高德控制台开启了“数字签名”，同时通过 `AMAP_WEB_SERVICE_PRIVATE_KEY` 注入对应私钥；插件按官方规则对包含 Key 的全部请求参数按名称排序，末尾追加私钥后计算 MD5 `sig`。私钥只在本地参与计算，不进入 URL、响应和错误信息。

远程 `apiBaseUrl` 只允许官方 `https://restapi.amap.com` 且禁止自定义端口；仅隔离回环测试地址允许 HTTP，避免把固定 Tool 变成访问第三方或内网的 SSRF 入口。

## 安全与生产边界

- 工具入口会校验关键词、六位 POI 类型码、最多 10 个 POI ID、经纬度范围，以及“同一检索条件最多 200 条”的组合分页边界。
- `maxResponseBytes` 限制供应商响应，保护进程内存；更小的 `maxToolResultBytes` 限制 Tool Result，避免大批 POI 挤占模型上下文和会话存储。
- 429、5xx、网络错误，以及官方错误码中的 QPS 限流和网关忙只做带双向抖动的有限指数退避；分钟封禁、日配额、Key、权限和参数错误快速失败。
- 供应商业务错误和 Tool 异常在返回 Agent 前遮蔽 URL 用户信息、Authorization、API Key、实际配置 Key 与控制字符。
- 每次真实 HTTP 尝试（包括重试）都计入进程内限流，重试不能绕过本地配额。
- `maxConcurrentRequests` 达到上限时快速失败，不创建无界等待 Promise；它与分钟限流共同保护进程和上游配额。
- Key 与 `sig` 位于查询串，所有请求使用 `redirect: "manual"`，任何 3xx 都作为失败返回，避免凭据随自动重定向泄露。
- 高德 `10004` 表示分钟访问量封禁且要到下一分钟才自动解封，因此不会立即重试；QPS 和网关瞬时错误才进入短退避。
- `ownerOnly=true` 可把高德 Key 的消耗限制给所有者调用。
- 三个路径虽是固定白名单，Origin 也必须锁定官方主机；“任意 HTTPS 都安全”是不成立的。
- 进程内限流不能替代多实例共享限流；集群部署需在网关或出口层统一保护配额。

`AmapClient.status()` 可提供同一客户端进程内的活跃请求数、当前分钟尝试数、成功/失败与拒绝计数，不包含查询和凭据。OpenClaw CLI Agent 可能运行在独立进程，因此该状态不能伪装成 Gateway 全局指标；生产多实例统计仍应接入共享遥测或出口限流层。

## 失败与重试决策

```mermaid
flowchart TD
    Call["一次 Tool Call"] --> Concurrent{"通过并发闸门？"}
    Concurrent -->|"否"| Fail["返回受控失败"]
    Concurrent -->|"是"| Limit{"本次 HTTP 尝试<br/>通过本地限流？"}
    Limit -->|"否"| Fail["返回受控失败"]
    Limit -->|"是"| Sign["可选生成 MD5 sig"] --> Request["固定 GET 路径请求高德<br/>禁止 3xx 跟随"]
    Request --> Result{"响应类型"}
    Result -->|"成功信封 status=1"| Bound{"Tool Result<br/>是否超限？"}
    Bound -->|"否"| Success["返回 Agent"]
    Bound -->|"是"| Fail
    Result -->|"429 / 5xx / 网络超时"| Retry{"仍有重试次数？"}
    Result -->|"10014/10015/10016/10019/10020/10021"| Retry
    Result -->|"10004 分钟封禁 / 日配额 / Key / 权限 / 参数 / 畸形信封"| Fail
    Retry -->|"是，指数退避"| Limit
    Retry -->|"否"| Fail
```

这张图中的两个“上限”解决不同问题：供应商响应即使在 1 MiB 内，也可能仍然远大于一次合理的模型工具结果，因此不能只设置 `maxResponseBytes`。

## 验证

```bash
openclaw plugins doctor
pnpm --filter @partme.ai/openclaw-amap typecheck
pnpm --filter @partme.ai/openclaw-amap test
pnpm --filter @partme.ai/openclaw-amap test:coverage
pnpm --filter @partme.ai/openclaw-amap build
OPENCLAW_E2E_HOST_GATEWAY=1 pnpm test:e2e -- --plugins amap --skip-browser
```

独立 E2E 从正式 tarball 安装插件，真实发起 Agent Tool Call；本地高德协议夹具独立计算数字签名、先返回 503、再返回 POI，验证两次请求签名均正确、安全 GET 只重试一次，并确认 Tool Result 回到模型 transcript。环境验收还应覆盖：真实合法地点搜索、非法经纬度、Key/私钥轮换、429、上游超时和超大响应。

官方依据：[地点搜索 2.0](https://developer.amap.com/api/webservice/guide/api-advanced/newpoisearch)、[数字签名](https://developer.amap.com/faq/quota-key/key/41181/)、[错误码说明](https://developer.amap.com/api/webservice/guide/tools/info)。
