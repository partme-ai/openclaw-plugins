<div align="center">

# OpenClaw Nacos

**OpenClaw 插件：Nacos 配置中心合并与 Gateway / Hooks 命名注册**

![npm](https://img.shields.io/badge/npm-2026.5.12-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![Nacos](https://img.shields.io/badge/Nacos-SDK-orange)

</div>

[简体中文](https://github.com/partme-ai/openclaw-nacos/blob/main/README.zh-CN.md) | [English](https://github.com/partme-ai/openclaw-nacos/blob/main/README.md)

`@partme.ai/openclaw-nacos` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 开发的 [Nacos](https://nacos.io/) 集成插件：提供 **命名注册**（Gateway / Hooks 服务发现）与可选的 **配置中心**（远程配置合并、写盘前备份、订阅变更）。推荐使用 OpenClaw CLI 安装到扩展目录；也可通过 npm 手动接入。

## 📖 简介

**OpenClaw Nacos**（`@partme.ai/openclaw-nacos`）基于 Node.js SDK [`nacos`](https://github.com/nacos-group/nacos-sdk-nodejs)，在 Gateway 已就绪后向 Nacos 注册 **临时实例**，并可选地从 Nacos **拉取配置**、与当前运行配置 **深度合并**、在调用 `runtime.config.writeConfigFile` 前 **备份** 本地配置文件，且支持 **订阅** dataId 变更后重新合并写盘。

### 🎯 核心能力

#### **命名注册（Naming）**

- 使用 `NacosNamingClient` 将当前 OpenClaw 节点注册为 **临时实例**，便于其他服务按服务名发现 **IP + 端口**（与 Gateway 监听端口一致，含 [Hooks](https://docs.openclaw.ai) / Webhook 路径元数据）。
- 端口解析与 OpenClaw 一致：`OPENCLAW_GATEWAY_PORT` → `gateway.port` → 默认 `18789`。

#### **配置中心（Config Center，可选）**

- 使用 `NacosConfigClient` 从 Nacos 加载配置。支持两种模式：
  - **主配置模式** (`primaryConfigDataId`)：将 **完整的** `openclaw.json` 存储在单个 Nacos dataId 中作为单一数据源。`sharedConfigs` 和 `pluginConfigIds` 仍会在其上叠加。
  - **共享配置模式** (`sharedConfigs`)：拉取多个局部配置并与当前运行时配置深度合并。
- 支持可选的 `applicationDataId` 和按插件 ID 的 `<pluginId>-<profile>.json`（通过 `pluginConfigIds`）。
- 写盘前备份当前配置文件，备份命名规则：`openclaw-nacos-<yyyyMMddHHmmss>.json`。
- 订阅 Nacos 配置变更并在每次变更时**重新应用**（拉取 → 合并 → 备份 → 写入）。
- 命名与配置共用 **`serverList` / `username` / `password` / 默认 `namespace`**；配置侧可用 **`configCenter.namespace`** 覆盖。

#### **Webhook 集群发现（新增）**

- 自动发现注册到同一 Nacos 服务名下的其他 Gateway 节点。
- 通过 Nacos 命名订阅维护**实时更新的**内存节点列表。
- 提供 `GET /nacos/cluster` HTTP 端点，返回完整节点元数据（IP、端口、hooks 路径、健康状态）。
- `GET /nacos/health` 端点包含集群发现状态和节点数量。

### ✨ 主要特性

#### 1. 命名与元数据

- **IP / 端口**：`registerIp` → `OPENCLAW_NACOS_REGISTER_IP` → 本机首个非回环 IPv4 → `127.0.0.1`（并警告）。
- **元数据**：`hooksEnabled`、`hooksBasePath`、`gatewayPort`、`provider` 及自定义 `metadata`（**勿**写入 `hooks.token` 等密钥）。

#### 2. 配置合并与占位符

- Nacos 正文支持 **JSON** 或 **YAML**（`yaml` 包解析）。
- 合并完成后对字符串做 **`${VAR}`** / **`${VAR:默认值}`** 形式的环境变量展开。

#### 3. 备份与写盘

- 备份源：`OPENCLAW_CONFIG_PATH`（若设置）否则 `stateDir/openclaw.json`。
- 备份目标：`stateDir/openclaw-nacos-<yyyyMMddHHmmss>.json`（本地时间 14 位时间戳）。

#### 4. 插件开关

| **开关** | **说明** |
| --- | --- |
| `enabled: false` | 禁用整个插件 |
| `naming.enabled: false` | 仅跳过命名注册，配置中心仍可使用 |
| `configCenter.enabled: true` | 启用配置拉取、合并、订阅与写盘 |
| `clusterDiscovery.enabled: false` | 仅跳过集群节点发现，命名注册仍会运行 |

#### 5. Webhook 集群

- **自动发现**：订阅 Nacos 命名变更 → 维护实时节点列表。
- **HTTP API**：`GET /nacos/cluster` 返回所有节点及 IP、端口、hooks 元数据。
- **健康检查**：`GET /nacos/health` 包含 `clusterDiscovery.running` 和节点数量。
- **自过滤**：本地节点自动从节点列表中排除。

### 🏗️ 插件内流程（概念）

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenClaw（Gateway 已监听）                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Nacos Naming │ │ Nacos Config │ │ 集群发现          │
│ 注册实例 +   │ │ pull→merge→ │ │ 订阅命名变更      │
│ Hooks 元数据  │ │ backup→write│ │ → 实时节点列表    │
└──────────────┘ └──────┬───────┘ └──────────────────┘
                        │
                        ▼
               subscribe → 再次 pull/merge
```

**启动顺序**：OpenClaw 先加载本地 `openclaw.json` 并启动 Gateway，本插件随后运行；首次从 Nacos 合并属于 **二次收敛**。若需进程启动前完全由 Nacos 引导，需要 OpenClaw 核心支持。

## 前置要求

- 已安装 [OpenClaw](https://github.com/openclaw/openclaw)（**2026.4.6+**，见 `package.json` 中 `peerDependencies` 与 `openclaw.compat` / `openclaw.build`）
- **Node.js 22+**（与官方 [Building plugins](https://docs.openclaw.ai/plugins/building-plugins) 前置要求一致；`engines` 亦声明 `>=22`）
- Gateway 所在机器能访问 **Nacos Server**（与 [nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs) 兼容的版本）

## 安装

### 1. 使用 OpenClaw CLI（推荐）

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

该命令通常会：

- 从 npm 下载插件包
- 安装到 OpenClaw 扩展目录（例如 `~/.openclaw/extensions/`）
- 按你使用的 OpenClaw 版本更新配置并注册插件

然后在 `plugins.entries` 中启用并填写插件配置（见下文）。具体行为以 [OpenClaw 文档](https://docs.openclaw.ai) 为准。

### 2. 使用 npm（手动 / 高级）

```bash
npm install @partme.ai/openclaw-nacos
```

再按你所用版本的规则，通过 `openclaw.plugin.json`、`plugins.entries` 等将包接入 OpenClaw。

## 配置

### Spring / Cloud 风格（可选）

除下方 **扁平 JSON** 外，可在 `plugins.entries.openclaw-nacos.config` 中使用嵌套的 `nacos` 对象（与 Spring Boot `application.yml` 常见写法对齐），插件会在解析时 **扁平化** 为内部字段；**已存在的顶层键优先生效**。

支持字段示例：

- `nacos.server-addr` → `serverList`
- `nacos.discovery.server-addr` → `namingServerList`（可选），并可在无顶层 `serverList` 时作为地址回退
- `nacos.discovery.namespace` → `namespace`（命名）
- `nacos.config.server-addr` → `configServerList`（可选）
- `nacos.config.namespace` → `configCenter.namespace`
- `nacos.config.shared-configs`：与 `configCenter.sharedConfigs` 相同语义；项内可使用 `data-id` 或 `dataId`

### npm 依赖：`nacos` 2.x

本插件 **仅支持** npm 包 [`nacos`](https://www.npmjs.com/package/nacos) **2.x**（源码仓库 [nacos-group/nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs)）。**不与** npm 上的旧主版本线混用；升级 SDK 大版本需单独评估 API。

### OpenClaw 插件 API 约定

- `package.json` 中的 **`openclaw`** 字段与官方 [Building plugins](https://docs.openclaw.ai/plugins/building-plugins) 示例结构一致：`extensions`（本 npm 包为 **`./dist/index.js`**；文档快速上手常用源码 `./index.ts`）、**`compat.pluginApi`**、**`compat.minGatewayVersion`**、**`build.openclawVersion` / `build.pluginSdkVersion`**。
- 入口使用官方推荐的 [`definePluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints)（从 `openclaw/plugin-sdk/plugin-entry` 导入），而非已弃用的单体 `openclaw/plugin-sdk` 根导入。
- 仅在 [`registrationMode === "full"`](https://docs.openclaw.ai/plugins/sdk-entrypoints#registration-mode) 时启动 Nacos 长生命周期服务（与文档中「重服务放在 full」一致）。
- 配置合并使用 [`api.runtime.config.loadConfig` / `writeConfigFile`](https://docs.openclaw.ai/plugins/sdk-runtime)（`loadConfig` 按文档可为异步）。
- 热更新前缀通过插件定义的 **`reload`** 字段声明（与 [`OpenClawPluginReloadRegistration`](https://docs.openclaw.ai/plugins/sdk-overview) 一致），由 Gateway 做重载规划。

### 配置变更与热更新

插件在清单级声明 `reload`（`restartPrefixes` / `hotPrefixes`），与 OpenClaw Gateway 配置重载规划配合：对 `plugins`、`gateway`、`channels` 等前缀倾向 **重启 Gateway**，对 `hooks`、`cron`、`models` 等倾向 **热更新**。从 Nacos 合并写盘后，实际行为以 OpenClaw 核心对变更路径的判定为准。

在 OpenClaw 配置文件（常见为 `~/.openclaw/openclaw.json`，或由 `OPENCLAW_CONFIG_PATH` 指定）中增加插件入口，例如 **仅命名注册** 的最小示例：

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

### 配置说明

#### 必填

| **字段** | **说明** |
| --- | --- |
| `serverList` | Nacos 地址，如 `host:8848` 或多地址逗号分隔 |
| `namingServerList` | 仅用于 Naming 客户端；默认同 `serverList` |
| `configServerList` | 仅用于 Config 客户端；默认同 `serverList` |

#### 命名相关（可选）

| **字段** | **默认值** | **说明** |
| --- | --- | --- |
| `enabled` | `true` | `false` 时禁用整个插件 |
| `naming.enabled` | `true` | `false` 时仅跳过命名注册 |
| `namespace` | `public` | 命名空间；未单独指定 `configCenter.namespace` 时作 Config 默认 |
| `username` / `password` | — | Nacos 认证（命名与配置客户端共用） |
| `serviceName` | `openclaw-gateway` | 服务名 |
| `groupName` | `DEFAULT_GROUP` | 分组 |
| `clusterName` | — | 集群名 |
| `weight` | `1` | 权重 |
| `ephemeral` | `true` | 是否临时实例 |
| `registerIp` | 环境 / 自动 | 注册到 Nacos 的 IP |
| `metadata` | — | 额外元数据（字符串键值） |

#### 配置中心 `configCenter`（可选）

| **字段** | **说明** |
| --- | --- |
| `configCenter.enabled` | `true` 时启用拉取、合并、订阅、写盘 |
| `configCenter.namespace` | 配置租户，覆盖顶层 `namespace`（仅 Config 客户端） |
| `configCenter.sharedConfigs` | `{ dataId, group?, refresh? }` 有序列表，按序 deep merge（Spring：`shared-configs`，`data-id` 等价 `dataId`） |
| `configCenter.applicationDataId` | 可选主配置 dataId（支持模板中的 `${profile}`） |
| `configCenter.profile` | profile，用于 dataId 与 `<pluginId>-<profile>.json` |
| `configCenter.pluginConfigIds` | 插件 ID 列表，合并到 `plugins.entries.<id>.config` |
| `configCenter.skipValidation` | `true` 时跳过插件侧额外校验（仍以 JSON 可序列化等为底线） |

#### 环境变量

| **变量** | **用途** |
| --- | --- |
| `OPENCLAW_GATEWAY_PORT` | 覆盖 Gateway 端口解析 |
| `OPENCLAW_NACOS_REGISTER_IP` | 未设置 `registerIp` 时的注册 IP |
| `OPENCLAW_CONFIG_PATH` | 若设置，备份时复制该路径对应文件 |
| `OPENCLAW_PROFILE` | profile（可被 `configCenter.profile` 覆盖） |
| `SPRING_PROFILES_ACTIVE` | 未设置 `OPENCLAW_PROFILE` 时作为 profile 来源 |

## 🔒 安全与风险

- **`runtime.config.writeConfigFile` 权限极高**，仅在可信环境启用配置中心；勿在 Nacos 配置正文或 metadata 中存放 `hooks.token` 等密钥。
- 其他服务发现实例后访问 Hooks 时，仍使用 OpenClaw 既有鉴权（如 `Authorization` / `X-OpenClaw-Token`），**不要**依赖 Nacos 元数据传递密钥。

## 🌐 消费方流程（其他服务）

1. 在 Nacos 中订阅对应 `serviceName`。
2. 选取实例 IP + 端口。
3. 拼接 Hooks URL：`http://<ip>:<port><hooksBasePath>/...`，并按 OpenClaw 文档携带鉴权头。

## ❓ 常见问题（FAQ）

### Q: Nacos 会在进程启动前完全替代本地 `openclaw.json` 吗？

**A:** 不会。OpenClaw 仍先加载本地配置并启动 Gateway，本插件在之后运行。配置中心做的是远程片段与运行中配置的合并并可写回磁盘，属于 **二次收敛**。若需要「启动前仅从 Nacos 引导」，需要 OpenClaw 核心支持。

### Q: Gateway 的 `gateway.auth.token` 要配进 Nacos 吗？

**A:** **不要。** 命名注册只发布 IP、端口与安全元数据；调用 Hooks 时仍使用你现有的 Gateway / Hooks 鉴权。不要把 `hooks.token` 或管理密钥写进 Nacos。

### Q: CI 构建产物在哪里查看？

**A:** 在仓库 [Actions](https://github.com/partme-ai/openclaw-nacos/actions) 中，每次执行 `ci.yml` 会上传 **`dist/`** 目录为工件（artifact 名 `openclaw-nacos-dist`）。

## 🤖 GitHub Actions

| **工作流** | **触发** | **说明** |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | 推送到 `main` / `master` 或 PR | `pnpm install --frozen-lockfile`、类型检查、构建、测试、上传 `dist` 工件 |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | 推送标签 `v*`（执行发布）；**Run workflow** 仅打包测试 | 构建、测试、npm 发布（版本已存在则跳过）、**GitHub Packages** 以 `@<GitHub owner>/openclaw-nacos`（如 `@partme-ai/...`）发布、**GitHub Release** 附带 `.tgz` |

**自动发布：** 在仓库 Secrets 中配置 **`NPM_TOKEN`**，详见 [RELEASING.md](./RELEASING.md)。**手动 Run workflow** 不会执行 npm 发布与 GitHub Release（需推送 `v*` 标签）。发布示例：

```bash
pnpm version patch
git push origin main --follow-tags
```

## 📁 项目结构

```
openclaw-nacos/
├── src/
│   ├── index.ts              # 插件入口（注册服务、HTTP 路由）
│   ├── nacos-registry.ts     # Nacos 命名注册（Gateway / Hooks）
│   ├── nacos-config-sync.ts  # Nacos 配置（合并、备份、订阅、主配置）
│   ├── nacos-cluster.ts      # Webhook 集群发现
│   ├── shared.ts             # 共享常量与工具
│   ├── types.ts
│   └── ...
├── docs/
│   ├── ARCHITECTURE.md       # 系统架构与设计
│   ├── CONFIG.md             # 完整配置参考
│   ├── GUIDE.md              # 使用指南与场景
│   ├── API.md                # HTTP 端点与导出 API
│   ├── TECHNICAL.md          # 技术细节与设计决策
│   └── zh/                   # 中文文档
│       ├── ARCHITECTURE.md
│       ├── CONFIG.md
│       ├── GUIDE.md
│       ├── API.md
│       └── TECHNICAL.md
├── dist/                     # 构建产出（发布到 npm）
├── openclaw.plugin.json      # OpenClaw 插件清单
├── package.json
└── README.md / README.zh-CN.md
```

### 📚 文档

- [架构文档](docs/zh/ARCHITECTURE.md) — 系统设计、模块、数据流
- [配置参考](docs/zh/CONFIG.md) — 完整配置 schema 与字段说明
- [使用指南](docs/zh/GUIDE.md) — 快速开始、使用场景、故障排查
- [API 参考](docs/zh/API.md) — HTTP 端点、CLI、导出模块
- [技术细节](docs/zh/TECHNICAL.md) — 技术栈、SDK 集成、设计决策

## 🛠️ 技术栈

| **类别** | **说明** |
| --- | --- |
| 运行时 | Node.js 22+、ESM |
| SDK | [`nacos`](https://github.com/nacos-group/nacos-sdk-nodejs)（Naming + Config） |
| 解析 | `yaml`（YAML 配置正文） |
| 宿主 | OpenClaw 插件 API（`registerService`、`runtime.config`） |

## 📦 版本信息

| **项目** | **版本** |
| --- | --- |
| @partme.ai/openclaw-nacos | 2026.5.12.2 |
| 推荐 Node | 22+ |

## 🔗 相关链接

| **资源** | **链接** |
| --- | --- |
| Nacos 官网 | [https://nacos.io](https://nacos.io) |
| nacos-sdk-nodejs | [https://github.com/nacos-group/nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs) |
| OpenClaw 文档 | [https://docs.openclaw.ai](https://docs.openclaw.ai) |
| OpenClaw 源码 | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| English | [README.md](./README.md) |

### OpenClaw 官方插件文档（Plugins）

| **说明** | **链接** |
| --- | --- |
| 插件总览 | [https://docs.openclaw.ai/tools/plugin](https://docs.openclaw.ai/tools/plugin) |
| 社区插件 | [https://docs.openclaw.ai/plugins/community](https://docs.openclaw.ai/plugins/community) |
| 捆绑包 | [https://docs.openclaw.ai/plugins/bundles](https://docs.openclaw.ai/plugins/bundles) |
| Voice call | [https://docs.openclaw.ai/plugins/voice-call](https://docs.openclaw.ai/plugins/voice-call) |

### 开发插件（Building plugins）

| **说明** | **链接** |
| --- | --- |
| 开发插件 | [https://docs.openclaw.ai/plugins/building-plugins](https://docs.openclaw.ai/plugins/building-plugins) |
| SDK 通道插件 | [https://docs.openclaw.ai/plugins/sdk-channel-plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins) |
| SDK 模型提供方插件 | [https://docs.openclaw.ai/plugins/sdk-provider-plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins) |
| SDK 迁移 | [https://docs.openclaw.ai/plugins/sdk-migration](https://docs.openclaw.ai/plugins/sdk-migration) |

### SDK 参考（SDK reference）

| **说明** | **链接** |
| --- | --- |
| SDK 概览 | [https://docs.openclaw.ai/plugins/sdk-overview](https://docs.openclaw.ai/plugins/sdk-overview) |
| SDK 入口 | [https://docs.openclaw.ai/plugins/sdk-entrypoints](https://docs.openclaw.ai/plugins/sdk-entrypoints) |
| SDK 运行时 | [https://docs.openclaw.ai/plugins/sdk-runtime](https://docs.openclaw.ai/plugins/sdk-runtime) |
| SDK 安装与配置 | [https://docs.openclaw.ai/plugins/sdk-setup](https://docs.openclaw.ai/plugins/sdk-setup) |
| SDK 测试 | [https://docs.openclaw.ai/plugins/sdk-testing](https://docs.openclaw.ai/plugins/sdk-testing) |
| 清单 manifest | [https://docs.openclaw.ai/plugins/manifest](https://docs.openclaw.ai/plugins/manifest) |
| 架构 architecture | [https://docs.openclaw.ai/plugins/architecture](https://docs.openclaw.ai/plugins/architecture) |

## 从源码构建（开发者）

```bash
pnpm install
pnpm run build
pnpm test
```

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 协议。

## 🙏 致谢

- [Nacos](https://nacos.io)
- [nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs)
- [OpenClaw](https://github.com/openclaw/openclaw)

---

<div align="center">

**如果这个项目对你有帮助，请给我们一个 ⭐️**

Made with ❤️ by PartMe

</div>
