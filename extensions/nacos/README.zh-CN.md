<div align="center">

# OpenClaw Nacos

**OpenClaw 插件：Nacos 配置中心合并与 Gateway / Hooks 命名注册**

![npm](https://img.shields.io/badge/npm-2026.5.12-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![Nacos](https://img.shields.io/badge/Nacos-SDK-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

`@partme.ai/openclaw-nacos` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 开发的 [Nacos](https://nacos.io/) 集成插件：提供**命名注册**（Gateway / Hooks 服务发现）与可选的**配置中心**（远程配置合并、写盘前备份、订阅变更）。

## 特性

**命名注册**

- 使用 `NacosNamingClient` 将当前节点注册为**临时实例**，便于其他服务发现 IP + 端口
- 支持 Hooks / Webhook 路径元数据发布
- 端口解析与 OpenClaw 一致：`OPENCLAW_GATEWAY_PORT` → `gateway.port` → 默认 `18789`

**配置中心**

- **主配置模式**（`primaryConfigDataId`）：将完整的 `openclaw.json` 存储在单个 Nacos dataId 中
- **共享配置模式**（`sharedConfigs`）：拉取多个局部配置并与运行时配置深度合并
- 支持 `applicationDataId` 和按插件 ID 的 `<pluginId>-<profile>.json` 配置
- 写盘前备份当前配置文件，命名规则：`openclaw-nacos-<yyyyMMddHHmmss>.json`
- 订阅 Nacos 配置变更，每次变更时重新应用

**Webhook 集群发现**

- 自动发现同一 Nacos 服务名下的其他 Gateway 节点
- 通过 Nacos 命名订阅维护**实时更新**的内存节点列表
- 提供 `GET /nacos/cluster` 和 `GET /nacos/health` HTTP 端点

## 前置要求

- 已安装 [OpenClaw](https://github.com/openclaw/openclaw)（**2026.4.6+**）
- **Node.js 22+**
- Gateway 所在机器能访问 **Nacos Server**

## 快速开始

### 安装

```bash
# 使用 OpenClaw CLI（推荐）
openclaw plugins install @partme.ai/openclaw-nacos

# 或使用 npm
npm install @partme.ai/openclaw-nacos
```

### 最小配置（仅命名注册）

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          "serverList": "127.0.0.1:8848",
          "namespace": "public",
          "username": "nacos",
          "password": "YOUR_NACOS_PASSWORD_HERE",
          "serviceName": "openclaw-gateway",
          "groupName": "DEFAULT_GROUP",
          "registerIp": "10.0.0.12",
          "metadata": { "env": "prod" }
        }
      }
    }
  },
  "gateway": { "port": 18789 },
  "hooks": {
    "enabled": true,
    "token": "your-secret-token",
    "path": "/hooks"
  }
}
```

## 配置说明

### 必填

| 字段 | 说明 |
|------|------|
| `serverList` | Nacos 地址，如 `host:8848` 或多地址逗号分隔 |
| `namingServerList` | 仅用于 Naming 客户端；默认同 `serverList` |
| `configServerList` | 仅用于 Config 客户端；默认同 `serverList` |

### 命名相关（可选）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | `false` 时禁用整个插件 |
| `naming.enabled` | `true` | `false` 时仅跳过命名注册 |
| `namespace` | `public` | 命名空间 |
| `username` / `password` | -- | Nacos 认证 |
| `serviceName` | `openclaw-gateway` | 服务名 |
| `groupName` | `DEFAULT_GROUP` | 分组 |
| `clusterName` | -- | 集群名 |
| `weight` | `1` | 权重 |
| `ephemeral` | `true` | 是否临时实例 |
| `registerIp` | 自动 | 注册到 Nacos 的 IP |
| `metadata` | -- | 额外元数据 |

### 配置中心 `configCenter`

| 字段 | 说明 |
|------|------|
| `configCenter.enabled` | `true` 时启用拉取、合并、订阅、写盘 |
| `configCenter.namespace` | 配置租户，覆盖顶层 `namespace` |
| `configCenter.sharedConfigs` | `{ dataId, group?, refresh? }` 有序列表 |
| `configCenter.applicationDataId` | 可选主配置 dataId |
| `configCenter.profile` | profile，用于 dataId 模板 |
| `configCenter.pluginConfigIds` | 插件 ID 列表 |
| `configCenter.skipValidation` | 跳过插件侧额外校验 |

### 插件开关

| 开关 | 说明 |
|------|------|
| `enabled: false` | 禁用整个插件 |
| `naming.enabled: false` | 仅跳过命名注册，配置中心仍可使用 |
| `configCenter.enabled: true` | 启用配置拉取、合并、订阅与写盘 |
| `clusterDiscovery.enabled: false` | 仅跳过集群节点发现 |

### 环境变量

| 变量 | 用途 |
|------|------|
| `OPENCLAW_GATEWAY_PORT` | 覆盖 Gateway 端口解析 |
| `OPENCLAW_NACOS_REGISTER_IP` | 未设置 `registerIp` 时的注册 IP |
| `OPENCLAW_CONFIG_PATH` | 备份时的配置文件路径 |
| `OPENCLAW_PROFILE` | profile（可被 `configCenter.profile` 覆盖） |
| `SPRING_PROFILES_ACTIVE` | 未设置 `OPENCLAW_PROFILE` 时作为 profile 来源 |

## 处理流程

```
OpenClaw（Gateway 已监听）
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Nacos   Nacos   集群发现
 Naming  Config  订阅命名变更
 注册    pull→merge  → 实时
 实例    →backup     节点列表
 +Hooks  →write
         │
         ▼
    subscribe → 再次 pull/merge
```

**启动顺序**：OpenClaw 先加载本地配置并启动 Gateway，本插件随后运行。首次从 Nacos 合并属于**二次收敛**。

## Spring / Cloud 风格配置

除扁平 JSON 外，可使用嵌套的 `nacos` 对象（与 Spring Boot `application.yml` 对齐）：

- `nacos.server-addr` → `serverList`
- `nacos.discovery.server-addr` → `namingServerList`
- `nacos.config.server-addr` → `configServerList`
- `nacos.config.shared-configs` → `configCenter.sharedConfigs`

## 安全与风险

- `runtime.config.writeConfigFile` 权限极高，仅在可信环境启用配置中心
- 勿在 Nacos 配置正文或 metadata 中存放 `hooks.token` 等密钥
- 其他服务发现实例后访问 Hooks 时，仍使用 OpenClaw 既有鉴权

## 项目结构

```
openclaw-nacos/
├── src/
│   ├── index.ts                 # 插件入口
│   ├── nacos-registry.ts        # Nacos 命名注册
│   ├── nacos-config-sync.ts     # Nacos 配置同步
│   ├── nacos-cluster.ts         # Webhook 集群发现
│   ├── shared.ts                # 共享常量与工具
│   └── types.ts
├── docs/
│   ├── ARCHITECTURE.md          # 架构文档
│   ├── CONFIG.md                # 配置参考
│   ├── GUIDE.md                 # 使用指南
│   ├── API.md                   # HTTP 端点
│   ├── TECHNICAL.md             # 技术细节
│   └── zh/                      # 中文文档
├── openclaw.plugin.json
├── package.json
└── README.md / README.zh-CN.md
```

## 常见问题

**Nacos 会在进程启动前完全替代本地 openclaw.json 吗？**

不会。OpenClaw 仍先加载本地配置并启动 Gateway，本插件在之后运行。配置中心做的是远程片段与运行中配置的合并。

**Gateway 的 auth.token 要配进 Nacos 吗？**

**不要。** 命名注册只发布 IP、端口与安全元数据；调用 Hooks 时仍使用 Gateway 鉴权。

## 相关链接

- [Nacos 官网](https://nacos.io)
- [nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs)
- [OpenClaw 文档](https://docs.openclaw.ai)

## 许可证

本项目采用 [MIT License](./LICENSE) 协议。
