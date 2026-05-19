# 配置参考 — openclaw-nacos

## 插件入口

所有配置位于 `openclaw.json` 的 `plugins.entries["openclaw-nacos"].config` 下。

## 完整 Schema

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          // ── 连接 ────────────────────────────────────
          "serverList": "127.0.0.1:8848",         // 必填：Nacos 服务地址（多个用逗号分隔）
          "namingServerList": "10.0.0.1:8848",     // 可选：独立 Naming 地址
          "configServerList": "10.0.0.2:8848",     // 可选：独立 Config 地址
          "namespace": "public",                    // 命名空间（租户隔离）
          "username": "nacos",                      // Nacos 认证用户名
          "password": "nacos",                      // Nacos 认证密码

          // ── 命名注册 ──────────────────────────────
          "serviceName": "openclaw-gateway",        // Nacos 中的服务名
          "groupName": "DEFAULT_GROUP",             // 服务分组
          "clusterName": "default",                 // 可选集群标签
          "weight": 1.0,                            // 负载均衡权重
          "ephemeral": true,                        // 临时实例（基于心跳）
          "registerIp": "192.168.1.100",            // 显式指定注册 IP
          "metadata": {                              // 自定义实例元数据
            "env": "prod",
            "region": "us-east-1"
          },

          // ── 命名开关 ──────────────────────────────
          "naming": {
            "enabled": true                          // false = 仅跳过注册
          },

          // ── 配置中心 ──────────────────────────────
          "configCenter": {
            "enabled": true,                         // 启用配置同步

            // 主配置（从 Nacos 加载完整 openclaw.json）
            "primaryConfigDataId": "openclaw.json",
            "primaryConfigGroup": "DEFAULT_GROUP",

            // 共享配置（按顺序深度合并）
            "sharedConfigs": [
              { "dataId": "base.yml", "group": "DEFAULT_GROUP", "refresh": true },
              { "dataId": "override.json", "refresh": false }
            ],

            // 应用配置（支持 ${profile} 模板）
            "applicationDataId": "application-${profile}.json",

            // 按插件配置（自动获取 {pluginId}-{profile}.json）
            "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],

            // Profile（默认：OPENCLAW_PROFILE → SPRING_PROFILES_ACTIVE → "default"）
            "profile": "dev",

            // 命名空间覆盖（仅用于 Config）
            "namespace": "config-ns",

            // 跳过验证（危险操作）
            "skipValidation": false
          },

          // ── 集群发现 ──────────────────────────────
          "clusterDiscovery": {
            "enabled": true                          // false = 跳过节点发现
          },

          // ── Spring 风格嵌套（替代方式）───────────
          "nacos": {
            "server-addr": "127.0.0.1:8848",
            "username": "nacos",
            "password": "nacos",
            "discovery": {
              "server-addr": "10.0.0.1:8848",
              "namespace": "public"
            },
            "config": {
              "server-addr": "10.0.0.2:8848",
              "shared-configs": [
                { "data-id": "base.yml", "group": "DEFAULT_GROUP" }
              ]
            }
          }
        }
      }
    }
  }
}
```

## 字段参考

### 连接

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|-------------|
| `serverList` | string | **必填** | Nacos 地址，如 `"host1:8848,host2:8848"` |
| `namingServerList` | string | `serverList` | Naming 客户端独立地址 |
| `configServerList` | string | `serverList` | Config 客户端独立地址 |
| `namespace` | string | `"public"` | Nacos 命名空间 |
| `username` | string | — | Nacos 认证用户名 |
| `password` | string | — | Nacos 认证密码 |

### 命名注册

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|-------------|
| `serviceName` | string | `"openclaw-gateway"` | 注册的服务名 |
| `groupName` | string | `"DEFAULT_GROUP"` | 服务分组 |
| `clusterName` | string | — | 实例集群标签 |
| `weight` | number | `1.0` | 负载均衡权重 |
| `ephemeral` | boolean | `true` | 临时实例（心跳维持） |
| `registerIp` | string | 自动检测 | 显式指定注册 IP |
| `metadata` | object | — | 自定义键值元数据 |
| `naming.enabled` | boolean | `true` | 设为 `false` 跳过注册 |

### 配置中心

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|-------------|
| `configCenter.enabled` | boolean | `false` | 启用 Nacos 配置同步 |
| `configCenter.namespace` | string | 顶层 `namespace` | 仅 Config 的命名空间覆盖 |
| `configCenter.primaryConfigDataId` | string | — | 完整 `openclaw.json` 对应的单个 dataId |
| `configCenter.primaryConfigGroup` | string | `"DEFAULT_GROUP"` | 主配置的分组 |
| `configCenter.sharedConfigs` | array | — | 按顺序合并的局部配置列表 |
| `configCenter.applicationDataId` | string | — | 应用级配置 dataId（支持 `${profile}`） |
| `configCenter.pluginConfigIds` | array | — | 需要获取配置的插件 ID 列表 |
| `configCenter.profile` | string | env → `"default"` | 用于配置文件命名的活动 profile |
| `configCenter.skipValidation` | boolean | `false` | 跳过写入前验证（危险） |

### 集群发现

| 字段 | 类型 | 默认值 | 说明 |
|-------|------|---------|-------------|
| `clusterDiscovery.enabled` | boolean | `true` | 设为 `false` 跳过节点发现 |

## 环境变量

| 变量 | 用途 | 优先级 |
|----------|---------|----------|
| `OPENCLAW_GATEWAY_PORT` | Gateway 监听端口 | 覆盖 `gateway.port` |
| `OPENCLAW_NACOS_REGISTER_IP` | Nacos 中注册的 IP | 被 `registerIp` 配置覆盖 |
| `OPENCLAW_PROFILE` | 配置命名的活动 profile | 被 `profile` 配置覆盖 |
| `SPRING_PROFILES_ACTIVE` | Spring 风格 profile 备用 | 最低优先级 |
| `OPENCLAW_CONFIG_PATH` | openclaw.json 路径（用于备份） | 配置文件位置 |

## 配置优先级

### 服务地址

```
namingServerList / configServerList > serverList
nacos.discovery.server-addr > nacos.server-addr
顶层扁平键 > Spring 风格 nacos.* 嵌套键
```

### 配置中心命名空间

```
configCenter.namespace > 顶层 namespace > "public"
```

### 注册 IP

```
registerIp 配置 > OPENCLAW_NACOS_REGISTER_IP 环境变量 > 首个 LAN IPv4 > 127.0.0.1
```

### Profile

```
configCenter.profile > OPENCLAW_PROFILE 环境变量 > SPRING_PROFILES_ACTIVE 环境变量 > "default"
```

## 最小示例

### 仅命名注册（服务发现）

```jsonc
{
  "openclaw-nacos": {
    "enabled": true,
    "config": {
      "serverList": "127.0.0.1:8848"
    }
  }
}
```

### 配置中心（主配置模式）

```jsonc
{
  "openclaw-nacos": {
    "enabled": true,
    "config": {
      "serverList": "127.0.0.1:8848",
      "configCenter": {
        "enabled": true,
        "primaryConfigDataId": "openclaw.json"
      }
    }
  }
}
```

### 生产环境完整配置

```jsonc
{
  "openclaw-nacos": {
    "enabled": true,
    "config": {
      "serverList": "nacos-prod-1:8848,nacos-prod-2:8848,nacos-prod-3:8848",
      "namespace": "production",
      "username": "nacos",
      "password": "${NACOS_PASSWORD}",
      "serviceName": "openclaw-gateway",
      "registerIp": "10.0.0.12",
      "metadata": { "env": "prod", "region": "us-east-1" },
      "configCenter": {
        "enabled": true,
        "primaryConfigDataId": "openclaw.json",
        "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],
        "profile": "prod"
      }
    }
  }
}
```
