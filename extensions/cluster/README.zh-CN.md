<div align="center">

# OpenClaw Cluster

**OpenClaw 集群协调 — 发现 · 配置同步 · 会话存储 · 代理**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

中文 | [English](README.md)

---

> **状态**: 核心实现已就绪 — 静态 / etcd / DNS SRV / Consul / Nacos / Redis / Eureka / mDNS 发现均已实现，Redis 与 PostgreSQL 会话存储、etcd 与共享文件系统配置同步、HTTP/gRPC 代理可用。

## 概述

随着 OpenClaw 部署规模扩大，运行多个 Gateway 实例成为高可用和负载均衡的必要选择。本插件解决集群化的核心挑战：

- **配置同步**：保持所有节点的 `openclaw.json` 一致
- **会话亲和性**：将用户路由到同一节点或共享会话状态
- **节点发现**：自动检测集群成员变化
- **跨节点路由**：当目标 Agent 在另一节点时转发消息

## 架构

```
                     Load Balancer / DNS
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
        Gateway-A    Gateway-B    Gateway-C
        (Node 1)     (Node 2)     (Node 3)
             │            │            │
             │   ┌────────┴────────┐   │
             │   │                 │   │
             │   │  openclaw_       │   │
             │   │  cluster        │   │
             │   │                 │   │
             └───┤  - discovery    ├───┘
                 │  - config-sync  │
                 │  - session-store│
                 │  - proxy        │
                 └────────┬────────┘
                          │
                    ┌─────┴─────┐
                    ▼           ▼
               etcd/Redis   共享存储
               (发现,配置)   (NFS/S3/EFS)
```

## 集群挑战与解决方案

| 挑战 | 说明 | 解决方案 |
|---|---|---|
| **配置同步** | `openclaw.json` 变更需同步到所有节点 | 共享存储（NFS/S3）+ 文件监听；或 etcd/Consul KV |
| **会话亲和性** | 同一用户的会话应路由到同一节点 | Sticky Session（LB 层）；或共享会话存储（Redis/PostgreSQL） |
| **记忆/知识库同步** | MEMORY.md、extraPaths 文件需多节点可读 | 共享文件系统（NFS/EFS）或对象存储 + 本地缓存 |
| **健康聚合** | management UI 需展示所有节点状态 | management 插件连接所有节点，聚合健康状态 |
| **节点发现** | 新节点加入/离开集群 | 静态配置；DNS SRV；etcd 注册 |
| **Leader 选举** | 某些操作（如配置写入）需单点执行 | etcd lease / Redis RedLock |
| **消息路由** | 用户消息到达 Node-A，但目标 Agent 在 Node-B | 节点间 WS 转发（类似 RabbitMQ delegate） |

## 目录结构

```
openclaw-cluster/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  openclaw.plugin.json
  src/
    index.ts                    # 入口：初始化集群服务
    types.ts                    # ClusterConfig, ClusterNodeInfo, 接口定义
    discovery/
      discovery.ts              # 发现服务工厂
      static-discovery.ts       # 静态节点列表发现 ✅
      etcd-discovery.ts         # etcd v3 HTTP API 发现 ✅
      dns-srv-discovery.ts      # DNS SRV 发现（K8s headless） ✅
      consul-discovery.ts       # Consul Agent API 发现 ✅
      nacos-discovery.ts        # Nacos Open API 发现 ✅
      redis-discovery.ts        # Redis SET + TTL 发现 ✅
      eureka-discovery.ts       # Eureka REST API 发现 ✅
      mdns-discovery.ts        # mDNS/Bonjour 局域网发现 ✅
      static-discovery.test.ts  # 静态发现单元测试
    config-sync/
      config-sync.ts            # 配置同步服务工厂
      etcd-config-sync.ts       # etcd KV 配置同步 ✅
      shared-fs-config-sync.ts  # 共享文件系统同步 ✅
    session-store/
      session-store.ts          # 会话存储工厂
      redis-session-store.ts    # Redis 共享存储 ✅
      pg-session-store.ts       # PostgreSQL 存储 ✅
    proxy/
      proxy.ts                  # 节点间代理工厂
      http-proxy.ts             # HTTP 代理 ✅
      grpc-proxy.ts             # gRPC 代理 ✅
```

## 集群模式

### 模式 1：单节点（默认）

无集群，所有内容使用本地文件存储。

```json
{
  "cluster": {
    "enabled": false
  }
}
```

### 模式 2：共享存储集群

多个节点通过 NFS 或云存储共享配置/会话文件。

```json
{
  "cluster": {
    "enabled": true,
    "mode": "shared-storage",
    "discovery": {
      "type": "static",
      "nodes": [
        "gateway-a.internal:18789",
        "gateway-b.internal:18789",
        "gateway-c.internal:18789"
      ]
    },
    "storage": {
      "path": "/mnt/shared/openclaw"
    }
  }
}
```

### 模式 3：etcd 协调集群

通过 etcd 集中管理配置和发现。

```json
{
  "cluster": {
    "enabled": true,
    "mode": "etcd",
    "discovery": {
      "type": "etcd",
      "endpoints": ["etcd-1:2379", "etcd-2:2379", "etcd-3:2379"],
      "prefix": "/openclaw/cluster"
    },
    "sessionStore": {
      "type": "redis",
      "url": "redis://redis-cluster:6379"
    }
  }
}
```

### 模式 4：基于 DNS 的发现

Kubernetes 风格的服务发现。

```json
{
  "cluster": {
    "enabled": true,
    "discovery": {
      "type": "dns",
      "serviceName": "openclaw-gateway.default.svc.cluster.local",
      "port": 18789
    }
  }
}
```

## 仅配置同步 + 负载层会话保持

若只需**多节点配置一致**、**不要求跨节点会话同步**，可采用「配置同步 + 负载均衡会话保持」的轻量方案：

- **配置同步**：使用 `configSync.type: "etcd-kv"` 或 `"shared-fs"`，保证各节点读到相同配置（agents、bindings、channels 等）。配置变更时，插件会触发本节点 Gateway 重载（`config.reload` / 文件重读）。
- **会话**：`sessionStore.type: "memory"` 即可，每个节点内存存自己的会话。
- **负载均衡**：在负载节点（Nginx/ALB/Ingress）上开启**会话保持**（基于 Cookie 或 IP），使同一客户端始终落在同一 Gateway 节点，会话自然落在该节点内存，无需 Redis/PostgreSQL。

该方案下无需启用 proxy（节点间转发）、无需共享 session store，仅需 discovery（可选，用于管理侧展示节点列表）和 configSync。

**shared-fs 示例**（各节点挂载同一 NFS/EFS，配置文件路径指向共享目录）：

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": { "type": "static", "staticNodes": ["node-1:18789", "node-2:18789"] },
    "configSync": {
      "type": "shared-fs",
      "sharedPath": "/mnt/openclaw-shared",
      "syncInterval": 5000
    },
    "sessionStore": { "type": "memory", "sessionTtl": 3600 },
    "proxy": { "port": 18790, "protocol": "http" }
  }
}
```

各节点启动时 `openclaw.json` 或 `_configPath` 指向共享目录下的 `openclaw.json`（如 `/mnt/openclaw-shared/openclaw.json`）；任一节点或管理端 `POST /cluster/config` 推送配置后，会写入共享文件，其他节点通过轮询/监听检测到变更并触发本机配置重载。

**etcd-kv 示例**：配置存 etcd，各节点轮询到变更后写回本地配置文件并触发重载（需运行时提供 `_configPath` / `configFile`）。

## 分阶段路线

- **V1（单节点）**：独立 Gateway，本地文件存储
- **V2（集群感知）**：management 插件连接多节点 WS，聚合展示；config sync 走 etcd
- **V3（完整集群）**：共享会话存储、节点间路由、Leader 选举

## 实现状态

### 已实现 ✅

- [x] 静态节点发现（从配置文件读取）
- [x] etcd 动态节点发现（v3 HTTP API、lease + 心跳）
- [x] etcd KV 配置同步（版本检测、变更通知）
- [x] 内存会话存储（单节点）
- [x] Redis 会话存储（原生 RESP 协议，零外部依赖）
- [x] HTTP 代理跨节点消息转发
- [x] Discovery → Proxy 集成（节点变更自动更新路由表）
- [x] 优雅关闭（SIGTERM/SIGINT）
- [x] HTTP API：`/cluster/status`、`/cluster/nodes`、`/cluster/config`、`/cluster/sessions`

- [x] DNS SRV 发现（K8s headless service，定时轮询 + 节点变更检测）
- [x] Consul 发现（Agent API 注册 + TTL 健康检查 + 健康节点轮询）
- [x] Nacos 发现（Open API 注册 + 心跳 + 健康实例列表）
- [x] Redis 发现（SET + TTL 自注册，SMEMBERS/GET 轮询，无额外依赖）
- [x] Eureka 发现（REST 注册 + 心跳 + 应用实例列表）
- [x] mDNS 发现（局域网组播，可选依赖 `multicast-dns`）
- [x] PostgreSQL 会话存储（UPSERT + TTL 清理，动态 `pg` 导入，降级到缓存模式）
- [x] 共享文件系统配置同步（NFS/EFS，文件锁 + 版本检测 + 轮询监听）
- [x] gRPC 代理传输（客户端池 + 动态 `@grpc/grpc-js` 导入，降级到 HTTP）

### 计划中

- [ ] Leader 选举（etcd lease）
- [ ] 节点故障时会话迁移
- [ ] 自动故障转移

## 节点发现方式对比与扩展

### 已实现

| 类型 | 说明 | 适用场景 | 配置要点 |
|------|------|----------|----------|
| **static** | 静态节点列表 | 开发/测试、节点数固定 | `staticNodes: ["host1:18789", "host2:18789"]` |
| **etcd** | etcd v3 注册与发现 | 生产、已有 etcd 基础设施 | `etcdEndpoints`、本节点会注册并心跳 |
| **dns-srv** | DNS SRV 记录 | Kubernetes Headless Service | `dnsDomain`（如 `_openclaw._tcp.openclaw-headless.default.svc.cluster.local`） |
| **consul** | Consul Agent API | 生产、HashiCorp 体系、多数据中心 | `consulAddress`、`serviceName`，本节点会注册并 TTL 续期 |
| **nacos** | Nacos Open API | 国内 Spring Cloud、Dubbo 体系 | `nacosAddress`、`nacosServiceName`，可选 `nacosNamespace`、`nacosGroupName` |
| **redis** | Redis SET + TTL 轮询 | 已有 Redis、轻量发现 | `redisUrl`、`redisKeyPrefix`（默认 `openclaw:cluster:nodes`） |
| **eureka** | Netflix Eureka REST | 老版 Spring Cloud 项目 | `eurekaAddress`、`eurekaAppName`（默认 `OPENCLAW-GATEWAY`） |
| **mdns** | mDNS/Bonjour 组播 | 局域网零中心、IoT、开发自发现 | `mdnsServiceType`（默认 `_openclaw._tcp.local`），需安装可选依赖 `multicast-dns` |

### 可扩展的其他主流发现方式

以下方案可按需增加对应 `DiscoveryConfig.type` 与实现类：

| 发现方式 | 说明 | 典型场景 | 实现复杂度 |
|----------|------|----------|------------|
| **Zookeeper** | 基于临时节点与 watch | Kafka、Hadoop 等已有 ZK 的集群 | 中（需 zk 客户端，ephemeral + children watch） |
| **Kubernetes API** | 直接查 K8s Endpoints / Pod 列表 | 仅跑在 K8s 内，无需额外组件 | 中（需 K8s 客户端或 REST + 认证） |
| **AWS Cloud Map / ECS** | 云厂商托管发现 | 全量 AWS 部署 | 中（SDK 或 HTTP） |

### Consul 配置示例

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": {
      "type": "consul",
      "consulAddress": "http://localhost:8500",
      "consulServiceName": "openclaw-gateway",
      "consulDatacenter": "dc1",
      "consulToken": "",
      "heartbeatInterval": 10000
    }
  }
}
```

本节点会向 Consul 注册为服务 `openclaw-gateway`，使用 TTL 15s 健康检查；可通过环境变量 `OPENCLAW_CLUSTER_ADDRESS`、`OPENCLAW_CLUSTER_PORT` 指定对外地址与端口。

### Nacos 配置示例

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": {
      "type": "nacos",
      "nacosAddress": "http://localhost:8848",
      "nacosServiceName": "openclaw-gateway",
      "nacosNamespace": "public",
      "nacosGroupName": "DEFAULT_GROUP",
      "heartbeatInterval": 10000
    }
  }
}
```

### Redis 发现配置示例

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": {
      "type": "redis",
      "redisUrl": "redis://localhost:6379",
      "redisKeyPrefix": "openclaw:cluster:nodes",
      "heartbeatInterval": 8000
    }
  }
}
```

### Eureka 配置示例

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": {
      "type": "eureka",
      "eurekaAddress": "http://localhost:8761/eureka",
      "eurekaAppName": "OPENCLAW-GATEWAY",
      "heartbeatInterval": 10000
    }
  }
}
```

### mDNS 配置示例

需安装可选依赖：`pnpm add multicast-dns`。

```json
{
  "cluster": {
    "nodeId": "node-1",
    "discovery": {
      "type": "mdns",
      "mdnsServiceType": "_openclaw._tcp.local"
    }
  }
}
```

## 配置参考

```typescript
interface ClusterConfig {
  enabled: boolean;
  nodeId?: string;           // 未指定则自动生成
  mode: 'single' | 'shared-storage' | 'etcd';
  
  discovery: {
    type: 'static' | 'etcd' | 'dns-srv' | 'consul' | 'nacos' | 'redis' | 'eureka' | 'mdns';
    staticNodes?: string[];   // 用于 static
    etcdEndpoints?: string[]; // 用于 etcd
    dnsDomain?: string;       // 用于 dns-srv
    consulAddress?: string;   // 用于 consul
    consulServiceName?: string;
    consulDatacenter?: string;
    consulToken?: string;
    nacosAddress?: string;    // 用于 nacos，如 http://localhost:8848
    nacosServiceName?: string;
    nacosNamespace?: string;
    nacosGroupName?: string;
    redisUrl?: string;        // 用于 redis
    redisKeyPrefix?: string;
    eurekaAddress?: string;   // 用于 eureka，如 http://localhost:8761/eureka
    eurekaAppName?: string;
    mdnsServiceType?: string; // 用于 mdns，默认 _openclaw._tcp.local
    heartbeatInterval?: number;
    nodeTimeout?: number;
  };
  
  configSync: {
    type: 'noop' | 'etcd' | 'shared-fs';
    watchInterval?: number;
  };
  
  sessionStore: {
    type: 'memory' | 'redis' | 'postgresql';
    url?: string;
    ttl?: number;
  };
  
  proxy: {
    type: 'http' | 'ws';
    timeout?: number;
  };
}
```

## HTTP API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/cluster/status` | GET | 集群概览（节点数、健康状态、运行时间） |
| `/cluster/nodes` | GET | 从 discovery 获取的详细节点列表 |
| `/cluster/config` | GET | 当前集群配置 |
| `/cluster/config` | POST | 推送配置变更到集群 |
| `/cluster/sessions` | GET | Session 跨节点分布统计 |

#### GET /cluster/status

```json
{
  "ok": true,
  "data": {
    "selfNodeId": "node-abc123",
    "totalNodes": 3,
    "onlineNodes": 3,
    "healthy": true,
    "discovery": "etcd",
    "configSync": "etcd-kv",
    "sessionStore": "redis",
    "proxyPort": 18790,
    "uptimeSeconds": 86400
  }
}
```

#### GET /cluster/sessions

```json
{
  "ok": true,
  "data": {
    "totalSessions": 150,
    "totalConnections": 42,
    "distribution": [
      { "nodeId": "gateway-a", "activeSessions": 50, "activeConnections": 14 },
      { "nodeId": "gateway-b", "activeSessions": 55, "activeConnections": 15 },
      { "nodeId": "gateway-c", "activeSessions": 45, "activeConnections": 13 }
    ]
  }
}
```

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

测试覆盖：
- `static-discovery.test.ts` — 静态节点发现（地址解析、生命周期、回调注册，8 个测试）

## 开发

```bash
pnpm install
pnpm build
pnpm dev   # watch 模式
```

## 依赖

当前零外部依赖 — 使用 Node.js 内置 `net` 模块实现 Redis RESP 协议，使用 `fetch` 调用 etcd v3 HTTP API。

生产部署建议替换为：
- `ioredis` - 完整 Redis 客户端（支持集群/哨兵模式）
- `etcd3` - 基于 gRPC 的 etcd 客户端（更好的性能和流式 watch）

## 与 RabbitMQ 集群对比

| 特性 | RabbitMQ | openclaw-cluster |
|---|---|---|
| 节点发现 | 内置 Erlang 集群 | 插件式（static/etcd/DNS） |
| 配置同步 | Erlang term 存储 | 文件系统或 etcd KV |
| 消息路由 | 内置 delegate | HTTP/WS 代理 |
| 会话状态 | Mnesia | Redis/PostgreSQL |
| Leader 选举 | Raft（仲裁队列） | etcd lease |

## OpenClaw 生态插件

| 插件 | 说明 |
|------|------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 认证 |
| [openclaw-cluster](https://github.com/partme-ai/openclaw-cluster) | 集群协调（发现 / 配置同步 / 会话存储 / 代理） |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT 协议接入 |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus 指标导出 |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP 服务端 |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | 链路追踪 |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [@partme.ai/wecom-kf](https://github.com/partme-ai/openclaw-plugins/tree/main/extensions/wecom-kf) | 企微客服渠道 |
| [@partme.ai/openclaw-bridge](https://github.com/partme-ai/openclaw-plugins/tree/main/extensions/bridge) | 跨 Gateway 消息转发/镜像 |

## License

## 许可证

MIT
