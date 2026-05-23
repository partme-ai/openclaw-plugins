# Architecture — openclaw-nacos

## System Overview

openclaw-nacos integrates OpenClaw Gateway with Nacos, providing three core capabilities:

1. **Config Center** — Load OpenClaw configuration from Nacos, merge with local config, back up before writes, subscribe to remote changes.
2. **Service Registration** — Register the Gateway instance as an ephemeral Nacos service with webhook/Hooks metadata.
3. **Cluster Discovery** — Subscribe to Nacos naming to discover peer Gateway nodes in real time.

```
┌──────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                               │
├──────────────────────────────────────────────────────────────────┤
│  openclaw-nacos plugin                                           │
│                                                                   │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐   │
│  │ NacosConfigSync     │  │ GatewayNacosRegistry             │   │
│  │ • primaryConfigDataId│  │ • register ephemeral instance    │   │
│  │ • sharedConfigs     │  │ • Hooks metadata                 │   │
│  │ • pluginConfigIds   │  │ • heartbeat                      │   │
│  │ • backup → write    │  │ • deregister on stop             │   │
│  │ • subscribe changes │  └──────────────┬───────────────────┘   │
│  └──────────┬──────────┘                 │                       │
│             │                            │                       │
│  ┌──────────┴────────────────────────────┴───────────────────┐   │
│  │ WebhookClusterService                                       │   │
│  │ • Subscribe naming → live peer list                        │   │
│  │ • Self-filtering (exclude own ip:port)                     │   │
│  │ • HTTP: GET /nacos/cluster → peer metadata                 │   │
│  │ • HTTP: GET /nacos/health  → component status              │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌──────────────────────────────────────────┐
│              Nacos Server                │
│  ┌────────────┐  ┌───────────────────┐   │
│  │ Naming     │  │ Config Center     │   │
│  │ (Distro)   │  │ (Raft)            │   │
│  └────────────┘  └───────────────────┘   │
└──────────────────────────────────────────┘
```

## Module Map

```
src/
├── index.ts                  Plugin entry (definePluginEntry)
│   • Registers 3 services: config, naming, cluster
│   • Registers HTTP routes: /nacos/health, /nacos/cluster
│
├── shared.ts                 Shared constants & utilities
│   • DEFAULT_GROUP, DEFAULT_NAMESPACE, DEFAULT_SERVICE
│   • createNacosSdkLogger() — Nacos SDK console adapter
│   • isPlainObject() — type guard
│
├── nacos-config-sync.ts      Config Center engine
│   • NacosConfigSyncService class
│   • pullAndApply() — fetch, merge, validate, backup, write
│   • start() — create client, initial pull, subscribe
│   • stop() — unsubscribe, close client
│   • backupOpenClawConfig() — timestamped backup
│
├── nacos-registry.ts         Service Registration (Naming)
│   • GatewayNacosRegistry class
│   • register() — create Naming client, register instance
│   • stop() — deregister instance
│   • buildInstanceMetadata() — hooks + gateway metadata
│
├── nacos-cluster.ts          Cluster Discovery
│   • WebhookClusterService class
│   • start() — subscribe naming, maintain peer list
│   • stop() — unsubscribe, clear peers
│   • getPeers() / getState() — read current state
│
├── nacos-connection.ts       Client configuration
│   • buildNacosConfigClientOptions()
│   • resolveProfile(), expandDataIdTemplate()
│   • resolveServerAddr(), resolveConfigNamespace()
│
├── config-parse.ts           Plugin config parsing
│   • parseNacosPluginConfig() → discriminated union result
│   • parseConfigCenter() — configCenter subtree
│
├── spring-normalize.ts       Spring Cloud compat
│   • flattenSpringNacosPluginConfig()
│   • resolveNamingServerList(), resolveConfigServerList()
│
├── resolve-endpoint.ts       Network resolution
│   • resolveGatewayPort() — OPENCLAW_GATEWAY_PORT → config → 18789
│   • resolveRegisterIp() — config → env → LAN IPv4 → 127.0.0.1
│   • resolveHooksInfo() — hooks path normalization
│
├── env-expand.ts             ${VAR} placeholder expansion
├── merge-deep.ts             Deep merge for plain objects
├── format-timestamp.ts       yyyyMMddHHmmss formatter
├── parse-config-content.ts   JSON / YAML body parser
├── types.ts                  All TypeScript interfaces
├── openclaw-peer.d.ts        OpenClaw SDK type stubs
└── setup-entry.ts            Lightweight setup entry
```

## Service Lifecycle

### Registration Mode

The plugin uses OpenClaw's **service registration** pattern via `definePluginEntry`. Three services are registered and managed by the OpenClaw runtime:

| Service ID | Start | Stop |
|-----------|-------|------|
| `openclaw-nacos-config` | Creates ConfigClient, pulls configs, subscribes | Unsubscribes, closes client |
| `openclaw-nacos-naming` | Creates NamingClient, registers instance | Deregisters, closes client |
| `openclaw-nacos-cluster` | Creates NamingClient, subscribes peers | Unsubscribes, clears peer list |

All services are **long-lived** and only start when `registrationMode === "full"`.

### Startup Sequence

```
1. Gateway loads openclaw.json → starts HTTP server
2. Plugin register(api) called
3. api.registrationMode === "full" check
4. registerConfigCenterService → creates NacosConfigClient
5. registerNamingService → creates NacosNamingClient
6. registerClusterService → creates second NacosNamingClient
7. HTTP routes registered
8. HTTP routes registered
```

## Data Flow: Config Sync

```
Remote Nacos Config
        │
        ▼
  NacosConfigClient.getConfig(dataId, group)
        │
        ▼
  parseConfigBody() — JSON or YAML
        │
        ▼
  deepMerge(base, fetched) — order: primary → shared[] → app → plugins
        │
        ▼
  expandEnvPlaceholdersInValue() — ${VAR} resolution
        │
        ▼
  validateMergedConfig() — JSON serializability check
        │
        ▼
  backupOpenClawConfig() → stateDir/openclaw-nacos-yyyyMMddHHmmss.json
        │
        ▼
  api.runtime.config.replaceConfigFile() → openclaw.json on disk
        │
        ▼
  Gateway detects config change → reload (restart or hot reload)
```

## Data Flow: Service Registration

```
Gateway startup
        │
        ▼
  resolveGatewayPort() → port
  resolveRegisterIp() → ip
  resolveHooksInfo() → hooks metadata
        │
        ▼
  buildInstanceMetadata() → { hooksBasePath, gatewayPort, provider, ... }
        │
        ▼
  NacosNamingClient.registerInstance(serviceName, { ip, port, metadata })
        │
        ▼
  Nacos heartbeat loop (ephemeral instance)
        │
        ▼
  On stop: deregisterInstance()
```

## Consistency Model

| Data | Protocol | CAP | Rationale |
|------|----------|-----|-----------|
| Config | Raft (Nacos server-side) | CP | Config data must be strongly consistent |
| Service instances | Distro (Nacos server-side) | AP | High availability for service discovery |
| Local peer list | In-memory subscription | Eventual | Updated on Nacos push events |

## Key Design Decisions

### Separate Naming Clients for Registration vs Discovery

The plugin uses **two independent** `NacosNamingClient` instances:
- One for registration (owned by `GatewayNacosRegistry`)
- One for cluster discovery (owned by `WebhookClusterService`)

This separation ensures registration heartbeat continues even if discovery encounters issues, and vice versa.

### Config as Layered Merges, Not Replacement

Config from Nacos is **merged** into the current runtime config, not replaced. This preserves local settings not managed in Nacos. The `primaryConfigDataId` option provides a way to designate a single Nacos config as the authoritative base, with shared/plugin configs still layered on top.

### Backup Before Write

Every Nacos-triggered config write is preceded by a timestamped backup. This provides an audit trail and rollback capability. Backups are stored in the OpenClaw `stateDir` with the naming pattern `openclaw-nacos-yyyyMMddHHmmss.json`.

### Plugin Config IDs with Profile Support

Per-plugin config follows the convention `{pluginId}-{profile}.json` (e.g., `openclaw-weixin-dev.json`). The profile is resolved from plugin config → `OPENCLAW_PROFILE` → `SPRING_PROFILES_ACTIVE` → `"default"`.
