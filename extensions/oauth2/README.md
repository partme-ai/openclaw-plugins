<div align="center">

# openclaw-oauth2

**OAuth 2.0 认证后端 — Sa-Token · JWT · Introspection**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

中文 | [English](README.md)

---

> **状态**: 已实现 — OIDC Discovery、JWKS 缓存、JWT RS256 验证、Token Introspection、Scope-Role 映射、全局 Bearer Token 中间件均已完成。

参考 [rabbitmq_auth_backend_oauth2](https://www.rabbitmq.com/docs/oauth2) 设计，适配 [Sa-Token OAuth2](https://sa-token.cc/doc.html#/oauth2/readme)。

## 概述

与 `openclaw_management` 内置的 OAuth 登录（仅保护管理界面）不同，本插件在 **Gateway 层面** 运作，拦截所有 HTTP 请求，验证 Bearer Token 是否来自受信任的 Sa-Token OAuth2 Server。

核心功能：

- **OIDC Discovery**: 从 `/.well-known/openid-configuration` 自动获取 `jwks_uri`、`issuer` 等配置
- **JWKS 公钥缓存**: 自动获取并缓存 RS256 公钥，支持定时刷新（默认 1 小时）和 kid 未命中时强制刷新
- **JWT 本地验证**: 零网络开销的 RS256 签名验证，校验 `exp`、`iss`、`aud`，提取 Sa-Token 自定义 claims
- **Token Introspection**: 对不透明 UUID Token 的降级验证，调用 `/oauth2/check_token` 端点，短 TTL 缓存（30s）
- **Scope → Role 映射**: `openclaw:admin` → admin、`openclaw:operator` → operator、`openclaw:viewer` → viewer
- **全局中间件**: 自动注入 `AuthContext` 到所有请求，供下游插件（如 `openclaw_management`）使用

## 架构

```
客户端（Business 后台 / API 调用）
  │
  ├── Authorization: Bearer <JWT>          ← 主路径（零网络开销）
  ├── Authorization: Bearer <UUID Token>   ← 降级路径（一次 HTTP 调用）
  │
  ▼
┌──────────────────────────────────────────────┐
│  openclaw-oauth2 中间件                  │
│                                              │
│  1. 提取 Bearer Token                        │
│  2. 判断 Token 格式（JWT 3 段 / UUID）        │
│     ├── JWT → 本地验证（JWKS 公钥 + RS256）   │
│     │         ├── 成功 → 提取 claims          │
│     │         └── 失败 → 降级到 Introspection  │
│     └── UUID → Token Introspection            │
│               └── POST /oauth2/check_token    │
│  3. 解析 Sa-Token claims                      │
│     ├── loginId / tenantId / loginType        │
│     └── scope → Role 映射                     │
│  4. 注入 AuthContext → req.authContext         │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
               openclaw_management
         （读取 req.authContext 进行权限判断）
```

## 认证策略：JWT 优先 + Introspection 降级

| 步骤 | Token 类型 | 验证方式 | 网络开销 |
|------|-----------|----------|---------|
| 1 | JWT（3 段 base64url） | 本地 RS256 签名验证 | **零** |
| 2 | JWT 验证失败 | 降级到 Introspection | 1 次 HTTP |
| 3 | UUID 不透明 Token | 直接 Introspection | 1 次 HTTP |

## Sa-Token 协议契约

| 项目 | 约定 |
|------|------|
| **Token 格式** | JWT（RS256）优先，支持 UUID 降级 |
| **Client ID** | `openclaw-gateway` |
| **Scopes** | `openclaw:admin`、`openclaw:operator`、`openclaw:viewer` |
| **JWKS 端点** | `{issuerUrl}/.well-known/jwks.json` |
| **Introspection** | `{issuerUrl}/oauth2/check_token`（RFC 7662） |
| **自定义 Claims** | `loginId`、`tenantId`、`loginType` |

## 配置

```json
{
  "plugins": {
    "openclaw-oauth2": {
      "issuerUrl": "https://api.example.com",
      "clientId": "openclaw-gateway",
      "clientSecret": "your-client-secret",
      "audience": "openclaw-api",
      "scopeMapping": {
        "openclaw:admin": "admin",
        "openclaw:operator": "operator",
        "openclaw:viewer": "viewer"
      },
      "satoken": {
        "loginIdClaim": "loginId",
        "tenantIdClaim": "tenantId",
        "loginTypeClaim": "loginType"
      },
      "publicPaths": ["/health", "/auth/oauth2/status"],
      "jwksRefreshInterval": 3600000,
      "introspectionCacheTtl": 30000
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `issuerUrl` | string | — | Sa-Token OAuth2 Server 地址（必填） |
| `clientId` | string | — | OAuth2 Client ID |
| `clientSecret` | string | — | OAuth2 Client Secret |
| `audience` | string | — | JWT aud 校验值（可选） |
| `scopeMapping` | object | 见上 | Scope → Role 映射 |
| `satoken.loginIdClaim` | string | `loginId` | JWT 中的用户 ID claim |
| `satoken.tenantIdClaim` | string | `tenantId` | JWT 中的租户 ID claim |
| `satoken.loginTypeClaim` | string | `loginType` | JWT 中的登录类型 claim |
| `publicPaths` | string[] | `["/health"]` | 无需认证的路径 |
| `jwksRefreshInterval` | number | `3600000` | JWKS 刷新间隔（ms，默认 1 小时） |
| `introspectionCacheTtl` | number | `30000` | Introspection 缓存 TTL（ms，默认 30 秒） |

## HTTP 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/auth/oauth2/status` | GET | 插件状态（启用状态、提供商信息） |

## 目录结构

```
openclaw-oauth2/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  openclaw.plugin.json
  src/
    index.ts                    # 入口：初始化 + 注册中间件
    types.ts                    # 类型定义（AuthContext, SaTokenClaims 等）
    middleware.ts               # Bearer Token 全局中间件
    satoken-discovery.ts        # OIDC Discovery + JWKS 获取/缓存
    satoken-jwt.ts              # JWT RS256 本地验证
    satoken-introspection.ts    # Token Introspection（UUID 降级）
    satoken-scope-mapper.ts     # Scope → Role/Permission 映射
    satoken-scope-mapper.test.ts # Scope 映射单元测试
    satoken-jwt.test.ts         # JWT 格式检测单元测试
```

## 实现状态

- [x] 插件骨架和状态端点
- [x] OIDC Discovery（自动获取 JWKS URI、issuer 等）
- [x] JWKS 公钥获取、缓存和定时刷新
- [x] JWT RS256 签名验证
- [x] Sa-Token Claims 提取（loginId、tenantId、loginType）
- [x] 不透明 Token Introspection（RFC 7662）
- [x] Scope → Role/Permission 映射
- [x] 全局 Bearer Token 中间件
- [x] AuthContext 注入（供 `openclaw_management` 等消费）
- [ ] Token 刷新流程（SCRM 后端负责）
- [ ] 多提供商支持

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

测试覆盖：
- `satoken-scope-mapper.test.ts` — Scope→Role 映射、优先级、自定义配置（14 个测试）
- `satoken-jwt.test.ts` — JWT 格式检测（6 个测试）

## 开发

```bash
pnpm install
pnpm build
pnpm dev   # 监听模式
```

## OpenClaw 生态插件

| 插件 | 说明 |
|------|------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 认证 |
| [openclaw_cluster](https://github.com/partme-ai/openclaw_cluster) | 集群协调（发现 / 配置同步 / 会话存储 / 代理） |
| [openclaw_management](https://github.com/partme-ai/openclaw_management) | 管理 REST API + Prometheus + 定义导出/导入 + Web UI |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT 协议接入 |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus 指标导出 |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP 服务端 |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | 链路追踪 |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |

## 许可证

MIT
