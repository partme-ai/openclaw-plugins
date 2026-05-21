<div align="center">

# OpenClaw Cluster

**OpenClaw Cluster Coordination — Discovery · Config Sync · Session Store · Proxy**

![Version](https://img.shields.io/badge/Version-0.1.0-blue) ![License](https://img.shields.io/badge/License-MIT-green)

</div>

[中文](README.zh-CN.md) | English

---

> **Status**: Feature-complete — static/etcd/DNS SRV/Consul/Nacos/Redis/Eureka/mDNS discovery, Redis/PostgreSQL session stores, etcd KV/shared-FS config sync, HTTP/gRPC proxies.

## Overview

As OpenClaw deployments scale, running multiple Gateway instances becomes necessary for high availability and load distribution. This plugin addresses the core challenges of clustering:

- **Configuration Synchronization**: Keep `openclaw.json` consistent across all nodes
- **Session Affinity**: Route users to the same node or share session state
- **Node Discovery**: Automatic detection of cluster membership changes
- **Cross-node Routing**: Forward messages when target agent is on another node

## Architecture

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
               etcd/Redis   Shared Storage
               (discovery,  (NFS/S3/EFS)
                config)
```

## Cluster Challenges & Solutions

| Challenge | Description | Solution |
|---|---|---|
| **Config Sync** | `openclaw.json` changes must sync to all nodes | Shared storage (NFS/S3) + file watch; or etcd/Consul KV |
| **Session Affinity** | Same user's session should route to same node | Sticky session (LB layer); or shared session store (Redis/PostgreSQL) |
| **Memory/Knowledge Sync** | MEMORY.md, extraPaths files need multi-node access | Shared filesystem (NFS/EFS) or object storage + local cache |
| **Health Aggregation** | Management UI needs to show all nodes' status | Management plugin connects to all nodes, aggregates health |
| **Node Discovery** | New nodes join/leave cluster | Static config; DNS SRV; etcd registration |
| **Leader Election** | Some operations (config write) need single-point execution | etcd lease / Redis RedLock |
| **Message Routing** | Message arrives at Node-A but target Agent is on Node-B | Inter-node WS forwarding (similar to RabbitMQ delegate) |

## Directory Structure

```
openclaw_cluster/
  package.json
  tsconfig.json
  tsup.config.ts
  openclaw.plugin.json
  src/
    index.ts              # Entry: initialize cluster services
    types.ts              # ClusterConfig, ClusterNodeInfo, interfaces
    discovery/
      discovery.ts          # Discovery service factory
      static-discovery.ts   # Static node list discovery
      etcd-discovery.ts     # etcd v3 HTTP API based discovery ✅
    config-sync/
      config-sync.ts            # Config sync service factory
      etcd-config-sync.ts       # etcd KV config sync ✅
      shared-fs-config-sync.ts  # Shared filesystem sync ✅
    session-store/
      session-store.ts          # Session store factory
      redis-session-store.ts    # Redis shared store ✅
      pg-session-store.ts       # PostgreSQL store ✅
    proxy/
      proxy.ts                  # Inter-node proxy factory
      http-proxy.ts             # HTTP proxy ✅
      grpc-proxy.ts             # gRPC proxy ✅
```

## Cluster Modes

### Mode 1: Single Node (Default)

No clustering, local file storage for everything.

```json
{
  "cluster": {
    "enabled": false
  }
}
```

### Mode 2: Shared Storage Cluster

Multiple nodes share config/session files via NFS or cloud storage.

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

### Mode 3: etcd-coordinated Cluster

Centralized configuration and discovery via etcd.

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

### Mode 4: DNS-based Discovery

Kubernetes-style service discovery.

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

## Phased Roadmap

- **V1 (Single Node)**: Stand-alone Gateway, local file storage — managed by `openclaw_management`
- **V2 (Cluster Aware)**: Management plugin connects to multiple Gateway nodes, aggregates health/metrics; config sync via etcd
- **V3 (Full Cluster)**: Shared session store, cross-node message routing, leader election

## Implementation Status

### Implemented ✅

- [x] Static node discovery (from config file)
- [x] etcd-based node discovery (v3 HTTP API, lease + heartbeat)
- [x] etcd KV configuration synchronization
- [x] In-memory session store (single node)
- [x] Redis session store (native RESP protocol, no external deps)
- [x] HTTP proxy for cross-node message forwarding
- [x] Discovery → Proxy integration (auto-update route table on node change)
- [x] Graceful shutdown (SIGTERM/SIGINT)
- [x] HTTP API: `/cluster/status`, `/cluster/nodes`, `/cluster/config`, `/cluster/sessions`

- [x] DNS SRV discovery (K8s headless service, periodic polling + node change detection)
- [x] PostgreSQL session store (UPSERT + TTL cleanup, dynamic `pg` import, cache-only fallback)
- [x] Shared filesystem config sync (NFS/EFS, file lock + version detection + poll)
- [x] gRPC proxy transport (client pool + dynamic `@grpc/grpc-js` import, HTTP fallback)

### Planned

- [ ] Leader election (etcd lease)
- [ ] Session migration on node failure
- [ ] Automatic failover

## Configuration Reference

```typescript
interface ClusterConfig {
  enabled: boolean;
  nodeId?: string;           // Auto-generated if not specified
  mode: 'single' | 'shared-storage' | 'etcd';
  
  discovery: {
    type: 'static' | 'etcd' | 'dns';
    nodes?: string[];         // For static
    endpoints?: string[];     // For etcd
    serviceName?: string;     // For DNS
    refreshInterval?: number; // Discovery refresh (ms)
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

## Monitoring

### HTTP API

| Endpoint | Method | Description |
|---|---|---|
| `/cluster/status` | GET | Cluster overview (nodes, health, uptime) |
| `/cluster/nodes` | GET | Detailed node list from discovery |
| `/cluster/config` | GET | Current cluster configuration |
| `/cluster/config` | POST | Push configuration change to cluster |
| `/cluster/sessions` | GET | Session distribution across nodes |

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

## Testing

```bash
pnpm test            # run unit tests
pnpm test:watch      # watch mode
pnpm test:coverage   # coverage report
```

Test coverage:
- `static-discovery.test.ts` — Static node discovery (address parsing, lifecycle, callbacks, 8 tests)

## Development

```bash
pnpm install
pnpm build
pnpm dev   # watch mode
```

## Dependencies

Currently zero external dependencies — uses Node.js built-in `net` module for Redis RESP protocol and `fetch` for etcd v3 HTTP API.

For production deployments, consider replacing with:
- `ioredis` - Full-featured Redis client with cluster/sentinel support
- `etcd3` - gRPC-based etcd client for better performance and streaming watch

## Comparison with RabbitMQ Clustering

| Feature | RabbitMQ | openclaw_cluster |
|---|---|---|
| Node Discovery | Built-in Erlang clustering | Plugin-based (static/etcd/DNS) |
| Config Sync | Erlang term storage | File system or etcd KV |
| Message Routing | Built-in delegate | HTTP/WS proxy |
| Session State | Mnesia | Redis/PostgreSQL |
| Leader Election | Raft (quorum queues) | etcd lease |

## Related OpenClaw plugins

| Plugin | Description |
|--------|--------------|
| [openclaw-oauth2](https://github.com/partme-ai/openclaw-oauth2) | OAuth2 authentication |
| [openclaw_cluster](https://github.com/partme-ai/openclaw_cluster) | Cluster coordination (discovery, config sync, session store, proxy) |
| [openclaw_ics](https://github.com/partme-ai/openclaw_ics) | Intelligent Customer Service API |
| [openclaw_management](https://github.com/partme-ai/openclaw_management) | Management REST API, Prometheus, definitions, Web UI |
| [openclaw-mqtt](https://github.com/partme-ai/openclaw-mqtt) | MQTT protocol adapter |
| [openclaw-prometheus](https://github.com/partme-ai/openclaw-prometheus) | Prometheus metrics exporter |
| [openclaw-stomp](https://github.com/partme-ai/openclaw-stomp) | STOMP server |
| [openclaw-tracing](https://github.com/partme-ai/openclaw-tracing) | Distributed tracing |
| [openclaw-web-mqtt](https://github.com/partme-ai/openclaw-web-mqtt) | WebSocket MQTT |
| [openclaw-web-stomp](https://github.com/partme-ai/openclaw-web-stomp) | WebSocket STOMP |
| [openclaw_wecom_kf](https://github.com/partme-ai/openclaw_wecom_kf) | WeChat Work customer service channel |

## Future Plugins (Cluster-related)

| Plugin | RabbitMQ Analog | Description |
|---|---|---|
| openclaw_bridge | rabbitmq_shovel | Cross-gateway message forwarding / mirroring |
| openclaw_federation | rabbitmq_federation | Multi-region gateway federation |
| openclaw_top | rabbitmq_top | Real-time Agent/Session resource leaderboard |

## License

MIT
