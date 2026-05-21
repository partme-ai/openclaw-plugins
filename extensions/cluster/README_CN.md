<div align="center">

# openclaw_cluster

**OpenClaw 集群协调 -- 节点发现 / 配置同步 / 会话存储 / 跨节点代理**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw__cluster-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-cluster)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22+-brightgreen)](https://nodejs.org)

</div>

[English](./README.en.md) | 简体中文

---

> **状态**: 核心实现已就绪 -- 8 种发现机制、2 种会话存储、2 种配置同步、2 种代理传输均已实现。

## 功能特性

- **多模式节点发现** -- 支持 static、etcd、DNS SRV、Consul、Nacos、Redis、Eureka、mDNS 共 8 种方式
- **配置同步** -- 通过 etcd KV 或共享文件系统（NFS/EFS）保持各节点 `openclaw.json` 一致
- **会话存储** -- 内存、Redis、PostgreSQL 三种会话存储，支撑跨节点会话共享
- **跨节点代理** -- HTTP 与 gRPC 双协议，节点变更自动更新路由表
- **HTTP API** -- 提供 `/cluster/status`、`/cluster/nodes`、`/cluster/config`、`/cluster/sessions` 端点
- **优雅关闭** -- 支持 SIGTERM/SIGINT 信号，安全注销节点

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-cluster
```

### 最小配置（单节点模式）

```json
{
  "cluster": {
    "enabled": false
  }
}
```

### 共享存储集群模式

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

### etcd 协调集群模式

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

### DNS 服务发现模式

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

## 配置参考

```typescript
interface ClusterConfig {
  enabled: boolean;
  nodeId?: string;           // 未指定则自动生成
  mode: 'single' | 'shared-storage' | 'etcd';

  discovery: {
    type: 'static' | 'etcd' | 'dns-srv' | 'consul' | 'nacos' | 'redis' | 'eureka' | 'mdns';
    staticNodes?: string[];
    etcdEndpoints?: string[];
    dnsDomain?: string;
    consulAddress?: string;
    consulServiceName?: string;
    consulDatacenter?: string;
    consulToken?: string;
    nacosAddress?: string;
    nacosServiceName?: string;
    nacosNamespace?: string;
    nacosGroupName?: string;
    redisUrl?: string;
    redisKeyPrefix?: string;
    eurekaAddress?: string;
    eurekaAppName?: string;
    mdnsServiceType?: string;
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

## 轻量方案：仅配置同步 + LB 会话保持

若只需多节点配置一致、不要求跨节点会话同步，可采用以下轻量方案：

- **配置同步**：`configSync.type: "etcd-kv"` 或 `"shared-fs"`，节点检测到变更后触发本机配置重载
- **会话**：`sessionStore.type: "memory"`，每个节点内存存自己的会话
- **负载均衡**：在 Nginx/ALB/Ingress 上开启会话保持（Cookie 或 IP），同一客户端始终落在同一节点

无需启用 proxy 和共享 session store。

## 节点发现方式对比

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| **static** | 静态节点列表 | 开发/测试、节点数固定 |
| **etcd** | etcd v3 注册与发现 | 生产环境、已有 etcd 基础设施 |
| **dns-srv** | DNS SRV 记录 | Kubernetes Headless Service |
| **consul** | Consul Agent API | HashiCorp 体系、多数据中心 |
| **nacos** | Nacos Open API | 国内 Spring Cloud/Dubbo 体系 |
| **redis** | Redis SET + TTL 轮询 | 已有 Redis、轻量发现 |
| **eureka** | Netflix Eureka REST | 老版 Spring Cloud 项目 |
| **mdns** | mDNS/Bonjour 组播 | 局域网零中心、IoT 自发现 |

## HTTP API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/cluster/status` | GET | 集群概览（节点数、健康状态、运行时间） |
| `/cluster/nodes` | GET | 详细节点列表 |
| `/cluster/config` | GET | 当前集群配置 |
| `/cluster/config` | POST | 推送配置变更到集群 |
| `/cluster/sessions` | GET | Session 跨节点分布统计 |

## 集群挑战与解决方案

| 挑战 | 说明 | 解决方案 |
|------|------|----------|
| **配置同步** | `openclaw.json` 变更需同步到所有节点 | 共享存储 + 文件监听；或 etcd/Consul KV |
| **会话亲和性** | 同一用户会话应路由到同一节点 | Sticky Session；或共享会话存储 |
| **记忆/知识库同步** | 多节点可读 | 共享文件系统或对象存储 + 本地缓存 |
| **健康聚合** | 管理端需展示所有节点状态 | 连接所有节点，聚合健康状态 |
| **节点发现** | 新节点加入/离开集群 | 静态配置 / DNS SRV / etcd 注册 |
| **Leader 选举** | 配置写入等操作需单点执行 | etcd lease / Redis RedLock |
| **消息路由** | 用户消息到达 A 节点但 Agent 在 B 节点 | 节点间 WS 转发 |

## 技术细节

- 当前**零外部依赖**：使用 Node.js 内置 `net` 模块实现 Redis RESP 协议，`fetch` 调用 etcd v3 HTTP API
- Redis 发现基于 `SET + TTL` 自注册 + `SMEMBERS/GET` 轮询
- PostgreSQL 会话存储支持 UPSERT + TTL 清理，动态导入 `pg` 并支持降级到缓存模式
- gRPC 代理使用客户端池 + 动态 `@grpc/grpc-js` 导入，支持 HTTP 降级
- 生产部署建议替换为 `ioredis`（集群/哨兵模式）和 `etcd3`（gRPC、流式 watch）

## 分阶段路线

- **V1（单节点）**：独立 Gateway，本地文件存储
- **V2（集群感知）**：management 插件连接多节点 WS，聚合展示；配置同步走 etcd
- **V3（完整集群）**：共享会话存储、节点间路由、Leader 选举

## 测试

```bash
pnpm test            # 运行单元测试
pnpm test:watch      # 监听模式
pnpm test:coverage   # 覆盖率报告
```

## 开发

```bash
pnpm install
pnpm build
pnpm dev             # watch 模式
```

## 许可证

MIT
