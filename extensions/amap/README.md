# OpenClaw AMap

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


适配 OpenClaw 2026.7.1 的高德 Web 服务 API 工具插件。它不是聊天渠道，不注册 Webhook，也不伪造消息发送能力。

## 调用架构

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
    User["用户地点问题"] --> Agent["OpenClaw Agent"]
    Agent --> Tool["AMap Tool<br/>Schema / ownerOnly"]
    Tool --> Client["AmapClient<br/>并发闸门 / 按尝试限流 / 安全 GET 重试"]
    Client --> Sign["可选数字签名<br/>排序参数 + privateKey → MD5 sig"]
    Sign -->|"仅官方 Origin + 固定 v5 路径；3xx 不跟随"| API["restapi.amap.com"]
    API --> Client --> ResponseBound["maxResponseBytes<br/>进程内存边界"]
    ResponseBound --> Tool --> ResultBound["maxToolResultBytes<br/>模型上下文边界"] --> Agent
```

## 工具

- `amap_search_places`：地点搜索 2.0，调用 `/v5/place/text`。
- `amap_search_nearby`：周边搜索 2.0，调用 `/v5/place/around`。
- `amap_place_detail`：地点详情 2.0，调用 `/v5/place/detail`。

## 配置

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

生产环境通过 `AMAP_WEB_SERVICE_KEY` 注入 Web 服务 Key；也可使用敏感配置项 `key`。若控制台为 Key 开启数字签名，通过 `AMAP_WEB_SERVICE_PRIVATE_KEY` 或敏感配置 `privateKey` 注入对应私钥。客户端按照官方规则生成 MD5 `sig`，私钥不离开进程。

`apiBaseUrl` 只允许官方 `https://restapi.amap.com` 且禁止自定义端口；回环 E2E 地址可使用 HTTP。由于 Key/`sig` 在查询串中，请求禁止自动跟随 3xx。

插件校验六位 POI 类型码、最多 10 个 POI ID、经纬度和 200 条组合分页边界。`maxResponseBytes` 保护进程内存，`maxToolResultBytes` 保护模型上下文；每次实际 HTTP 尝试（包括重试）都会消耗本地速率额度，`maxConcurrentRequests` 防止并发 Tool Call 形成无界等待。

429、5xx、网络错误，以及官方定义的 QPS/网关瞬时错误只做有限重试；`10004` 分钟封禁、日配额、Key、权限和参数错误不会立即重试。`AmapClient.status()` 只反映创建它的进程，不能替代多实例共享指标和统一限流。

```mermaid
flowchart LR
    E["HTTP 或业务失败"] --> T{"可短时恢复？"}
    T -->|"429 / 5xx / 网络 / QPS / 网关忙"| R["有限指数退避"]
    R --> Q["重新计入本地限流"] --> E
    T -->|"10004 分钟封禁 / 日配额 / Key / 权限 / 参数 / 3xx"| F["快速失败"]
```

安装态闭环验证：

```bash
OPENCLAW_E2E_HOST_GATEWAY=1 pnpm test:e2e -- --plugins amap --skip-browser
```

安装态 E2E 使用独立实现验证每次请求的官方 MD5 `sig`，再验证 503 安全重试与 Tool Result 回传。

官方接口依据：[地点搜索 2.0](https://developer.amap.com/api/webservice/guide/api-advanced/newpoisearch)、[数字签名](https://developer.amap.com/faq/quota-key/key/41181/)、[错误码说明](https://developer.amap.com/api/webservice/guide/tools/info)。
