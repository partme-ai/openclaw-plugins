# OpenClaw mTLS

**双向证书认证插件 -- 为 OpenClaw Gateway 提供 mTLS 安全保护**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mtls-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-mtls)
[![Node](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

[English](./README.en.md) | 简体中文

---

## 功能特性

- **双向认证** -- 服务端和客户端均需提供 X.509 证书进行双向验证
- **客户端证书验证** -- 提取并验证客户端证书的 CN、issuer、fingerprint
- **白名单控制** -- 通过 `allowedClients`（CN/issuer/fingerprint）细粒度控制访问权限
- **基于路径的保护** -- 通过 `protectedPaths` 配置哪些路径需要 mTLS 认证，支持精确匹配和前缀匹配
- **透传模式** -- 可选的 `passthrough` 模式，未提供证书时放行请求但不附加认证上下文
- **证书信息传递** -- 通过 HTTP Header 将客户端证书信息传递给下游服务
- **状态端点** -- 提供 `GET /mtls/status` 监控接口

## 快速开始

### 前置条件

- OpenClaw >= 2026.4.0
- Node.js 20+
- TLS 证书（服务器证书/私钥和用于验证客户端证书的 CA）

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-mtls
```

### 最小配置

```json
{
  "mtls": {
    "enabled": true,
    "tls": {
      "enabled": true,
      "certFile": "/path/to/server-cert.pem",
      "keyFile": "/path/to/server-key.pem",
      "caFile": "/path/to/ca-cert.pem",
      "requestCert": true,
      "rejectUnauthorized": true
    },
    "protectedPaths": [
      { "path": "/", "match": "prefix", "allowUnauthenticated": false }
    ],
    "allowedClients": [
      { "cn": "trusted-client-1" },
      { "cn": "trusted-client-2", "issuer": "My CA" }
    ],
    "skipPaths": ["/health", "/auth/status", "/mtls/status"],
    "passthrough": false,
    "headerName": "X-Client-Cert",
    "headerCertField": "subject"
  }
}
```

## 配置说明

### 顶层字段

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 启用/禁用 mTLS 插件 |
| `tls` | -- | TLS 服务器配置 |
| `protectedPaths` | `[{path:"/",match:"prefix"}]` | 需要 mTLS 认证的路径 |
| `allowedClients` | `[]` | 允许的客户端证书白名单 |
| `skipPaths` | 见下方 | 跳过认证的路径 |
| `passthrough` | `false` | 未提供证书时是否放行 |
| `headerName` | `X-Client-Cert` | 向下游传递证书信息的 Header |
| `headerCertField` | `subject` | 用于 Header 值的证书字段 |

### TLS 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `tls.enabled` | `true` | 启用 TLS |
| `tls.certFile` | -- | 服务器证书文件路径 |
| `tls.keyFile` | -- | 服务器私钥文件路径 |
| `tls.caFile` | -- | CA 证书文件路径（用于验证客户端证书） |
| `tls.requestCert` | `true` | 请求客户端证书 |
| `tls.rejectUnauthorized` | `true` | 拒绝未提供有效证书的客户端 |

### 路径规则

| 字段 | 说明 |
|------|------|
| `path` | 要保护的 URL 路径 |
| `match` | `exact`（精确匹配）或 `prefix`（前缀匹配） |
| `allowUnauthenticated` | 是否允许该路径的未认证访问 |

### 客户端白名单

`allowedClients` 中的每个条目可以指定以下字段，多个条件为 AND 关系：

| 字段 | 说明 |
|------|------|
| `cn` | 客户端证书 Common Name (CN) |
| `issuer` | 客户端证书签发者 |
| `fingerprint` | 客户端证书 SHA 指纹 |

## 工作原理

```
客户端（携带客户端证书）
    -> HTTPS + mTLS
    -> OpenClaw Gateway
    -> mTLS 中间件（验证客户端证书）
    -> 下游处理器
```

插件生命周期：
1. 通过 `registerHttpRoute` 在 Gateway 加载时注册
2. mTLS 中间件拦截受保护路径上的 HTTP 请求
3. 从 TLS socket 中提取客户端证书
4. 根据 `allowedClients` 白名单验证证书
5. 将认证上下文附加到请求中供下游使用
6. 状态端点：`GET /mtls/status`

## 常见问题

**TLS 和 mTLS 的区别是什么？**

标准 TLS 只验证服务端向客户端展示的证书。mTLS 添加了双向验证 -- 客户端也必须展示由服务端验证的证书。

**Gateway 如何处理 mTLS？**

OpenClaw Gateway 在代理/负载均衡层终止 TLS。mTLS 插件从 TLS socket 中提取客户端证书信息并强制执行认证策略。

**如何只允许特定客户端？**

使用 `allowedClients` 配置 CN、issuer 或 fingerprint。单个条目内的多个匹配条件是 AND 关系。

**当客户端未提供证书时会发生什么？**

默认情况下（`passthrough: false`），请求会被拒绝并返回 401。如果 `passthrough: true`，请求会被放行，但不会附加 `mtlsAuth` 上下文。

## 测试

```bash
npm test              # 单元测试
npm run build         # 构建
npm run typecheck     # 类型检查
```

## 项目结构

```
openclaw-mtls/
  src/
    index.ts              # 插件入口 -- registerHttpRoute 中间件
    types.ts              # 类型定义
    stats.ts              # 统计信息追踪
    openclaw-sdk.d.ts     # OpenClaw 类型声明
  test/
    mtls.test.ts          # 单元测试
  .github/workflows/
    ci.yml                # CI 工作流
    release.yml           # Release 工作流
  openclaw.plugin.json    # 插件元数据和配置 schema
  package.json
```

## 许可证

MIT
