# API 参考 — openclaw-nacos

## HTTP 端点

插件在 Gateway 的 HTTP 服务器上注册路由。

### GET /nacos/health

Nacos 插件组件级健康状态。

**认证**：无（内部诊断）

**响应**：
```json
{
  "status": "ok",
  "configSync": { "running": true },
  "naming": { "registered": true },
  "clusterDiscovery": { "running": true },
  "lastSyncTime": "2026-05-18T05:30:00.000Z",
  "lastError": null
}
```

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `status` | `"ok" \| "degraded"` | 整体健康状态 |
| `configSync.running` | boolean | 配置中心是否活跃 |
| `naming.registered` | boolean | 实例是否已在 Nacos 注册 |
| `clusterDiscovery.running` | boolean | 集群发现是否活跃 |
| `lastSyncTime` | string \| null | 最后一次配置同步的 ISO 时间戳 |
| `lastError` | string \| null | 脱敏后的错误信息（路径/IP 已移除） |

### GET /nacos/cluster

已发现的 webhook 集群中其他 Gateway 节点。

**认证**：无（内部诊断）

**响应**：
```json
{
  "peers": [
    {
      "ip": "10.0.0.5",
      "port": 18789,
      "serviceName": "openclaw-gateway",
      "groupName": "DEFAULT_GROUP",
      "clusterName": "default",
      "weight": 1.0,
      "healthy": true,
      "metadata": {
        "hooksBasePath": "/hooks",
        "hooksEnabled": "true",
        "gatewayPort": "18789",
        "provider": "openclaw-nacos",
        "env": "prod"
      }
    }
  ],
  "peerCount": 1,
  "lastUpdated": "2026-05-18T05:30:00.000Z",
  "discoveryRunning": true
}
```

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `peers` | ClusterPeer[] | 已发现节点（排除自身） |
| `peerCount` | number | 节点数量 |
| `lastUpdated` | string \| null | 节点列表最后更新时间 |
| `discoveryRunning` | boolean | 集群发现是否活跃 |

### ClusterPeer 对象

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `ip` | string | 节点 IP 地址 |
| `port` | number | Gateway 监听端口 |
| `serviceName` | string | Nacos 服务名 |
| `groupName` | string | Nacos 分组名 |
| `clusterName` | string \| undefined | Nacos 集群标签 |
| `weight` | number | 负载均衡权重 |
| `healthy` | boolean | 实例健康状态 |
| `metadata` | Record\<string, string\> | 实例元数据（hooks 路径、环境等） |

## 通过 HTTP 检查状态

插件健康可通过 `/nacos/health` 端点（见上文）或直接查询 Nacos 获取：

```bash
# 插件组件健康
curl http://localhost:18789/nacos/health

# Nacos 中已注册的实例
curl "http://localhost:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
```

等效输出示例（对应插件内部状态）：
```
Nacos Plugin Health:
  Config Sync:     running
  Naming:          registered
  Cluster Disc:    running  peers: 2
  Last Sync:       2026-05-18T05:30:00.000Z
  Last Error:      none
  Peer: 10.0.0.5:18789  healthy=true  weight=1.0
  Peer: 10.0.0.6:18789  healthy=true  weight=1.0
```

## 导出模块

插件导出以下内容供编程使用。

### 类

#### NacosConfigSyncService

```typescript
import { NacosConfigSyncService } from "@partme.ai/openclaw-nacos";
```

核心配置同步引擎。管理配置客户端生命周期、拉取合并管道、订阅和备份。

| 方法 | 说明 |
|--------|-------------|
| `start(deps)` | 创建客户端、初始拉取、订阅变更 |
| `stop(logger)` | 取消订阅、关闭客户端 |
| `pullAndApply(deps, client?)` | 拉取、合并、验证、备份、写入 |

#### GatewayNacosRegistry

```typescript
import { GatewayNacosRegistry } from "@partme.ai/openclaw-nacos";
```

命名注册服务。将 Gateway 注册为附带 Hooks 元数据的临时实例。

| 方法 | 说明 |
|--------|-------------|
| `register(params)` | 创建 Naming 客户端、注册实例 |
| `stop(logger)` | 注销实例 |

#### WebhookClusterService

```typescript
import { WebhookClusterService } from "@partme.ai/openclaw-nacos";
```

集群发现服务。订阅 Nacos 命名变更，维护实时节点列表。

| 方法 | 说明 |
|--------|-------------|
| `start(params)` | 创建 Naming 客户端、订阅、获取初始节点 |
| `stop(logger)` | 取消订阅、清空节点列表 |
| `getPeers()` | 返回当前 `ClusterPeer[]` |
| `getState()` | 返回 `ClusterServiceState`（含 peers 和 lastUpdated） |

### 工具函数

#### buildInstanceMetadata

```typescript
import { buildInstanceMetadata } from "@partme.ai/openclaw-nacos";
```

构建 Nacos 实例注册的元数据对象。

```typescript
function buildInstanceMetadata(params: {
  cfg: OpenClawConfigSlice;
  plugin: NacosPluginConfig;
  port: number;
}): Record<string, string>;
```

#### backupOpenClawConfig

```typescript
import { backupOpenClawConfig } from "@partme.ai/openclaw-nacos";
```

创建当前 OpenClaw 配置文件的时间戳备份。

```typescript
function backupOpenClawConfig(
  stateDir: string,
  env: NodeJS.ProcessEnv,
  logger: PluginLog,
): void;
```

#### deepMerge

```typescript
import { deepMerge } from "@partme.ai/openclaw-nacos";
```

深度合并两个纯对象。源中的数组和原始值替换目标。

```typescript
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T;
```

#### expandEnvPlaceholdersInValue

```typescript
import { expandEnvPlaceholdersInValue } from "@partme.ai/openclaw-nacos";
```

递归展开字符串值中的 `${VAR}` 和 `${VAR:默认值}` 占位符。

```typescript
function expandEnvPlaceholdersInValue(
  value: unknown,
  env: NodeJS.ProcessEnv,
): unknown;
```

#### parseNacosPluginConfig

```typescript
import { parseNacosPluginConfig } from "@partme.ai/openclaw-nacos";
```

将插件入口配置解析为可辨识联合结果。

```typescript
type ParsePluginConfigResult =
  | { kind: "skip"; reason: string }
  | { kind: "disabled" }
  | { kind: "ok"; config: NacosPluginConfig }
  | { kind: "error"; message: string };

function parseNacosPluginConfig(raw: unknown): ParsePluginConfigResult;
```

### 类型

```typescript
import type {
  NacosPluginConfig,
  NacosConfigCenterConfig,
  NacosSharedConfigItem,
  ClusterPeer,
  ClusterDiscoveryConfig,
  OpenClawConfigSlice,
  PluginLog,
} from "@partme.ai/openclaw-nacos";
```

### 共享常量

```typescript
import {
  DEFAULT_GROUP,      // "DEFAULT_GROUP"
  DEFAULT_NAMESPACE,  // "public"
  DEFAULT_SERVICE,    // "openclaw-gateway"
} from "@partme.ai/openclaw-nacos";
```
