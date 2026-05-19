# API Reference — openclaw-nacos

## HTTP Endpoints

The plugin registers HTTP routes on the Gateway's HTTP server.

### GET /nacos/health

Component-level health status for the Nacos plugin.

**Auth**: none (internal diagnostics)

**Response**:
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

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok" \| "degraded"` | Overall health |
| `configSync.running` | boolean | Config Center is active |
| `naming.registered` | boolean | Instance is registered in Nacos |
| `clusterDiscovery.running` | boolean | Cluster peer discovery is active |
| `lastSyncTime` | string \| null | ISO timestamp of last config sync |
| `lastError` | string \| null | Sanitized error message (paths/IPs redacted) |

### GET /nacos/cluster

Discovered peer Gateway nodes in the webhook cluster.

**Auth**: none (internal diagnostics)

**Response**:
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

| Field | Type | Description |
|-------|------|-------------|
| `peers` | ClusterPeer[] | Discovered peer nodes (excluding self) |
| `peerCount` | number | Number of peers |
| `lastUpdated` | string \| null | When peer list was last refreshed |
| `discoveryRunning` | boolean | Cluster discovery is active |

### ClusterPeer Object

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Peer IP address |
| `port` | number | Gateway listen port |
| `serviceName` | string | Nacos service name |
| `groupName` | string | Nacos group name |
| `clusterName` | string \| undefined | Nacos cluster label |
| `weight` | number | Load-balancing weight |
| `healthy` | boolean | Instance health status |
| `metadata` | Record\<string, string\> | Instance metadata (hooks path, env, etc.) |

## Status Check via HTTP

Plugin health can be checked through the `/nacos/health` endpoint (see above) or by querying Nacos directly:

```bash
# Plugin component health
curl http://localhost:18789/nacos/health

# Registered instances in Nacos
curl "http://localhost:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
```

Example output (equivalent to the plugin's internal state):
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

## Exported Modules

The plugin exports the following for programmatic use.

### Classes

#### NacosConfigSyncService

```typescript
import { NacosConfigSyncService } from "@partme.ai/openclaw-nacos";
```

Core config sync engine. Manages config client lifecycle, pull-and-merge pipeline, subscription, and backup.

| Method | Description |
|--------|-------------|
| `start(deps)` | Create client, initial pull, subscribe to changes |
| `stop(logger)` | Unsubscribe, close client |
| `pullAndApply(deps, client?)` | Fetch, merge, validate, backup, write |

#### GatewayNacosRegistry

```typescript
import { GatewayNacosRegistry } from "@partme.ai/openclaw-nacos";
```

Naming registration service. Registers the Gateway as an ephemeral instance with Hooks metadata.

| Method | Description |
|--------|-------------|
| `register(params)` | Create Naming client, register instance |
| `stop(logger)` | Deregister instance |

#### WebhookClusterService

```typescript
import { WebhookClusterService } from "@partme.ai/openclaw-nacos";
```

Cluster discovery service. Subscribes to Nacos naming changes to maintain a live peer list.

| Method | Description |
|--------|-------------|
| `start(params)` | Create Naming client, subscribe, fetch initial peers |
| `stop(logger)` | Unsubscribe, clear peer list |
| `getPeers()` | Returns current `ClusterPeer[]` |
| `getState()` | Returns `ClusterServiceState` with peers and lastUpdated |

### Utilities

#### buildInstanceMetadata

```typescript
import { buildInstanceMetadata } from "@partme.ai/openclaw-nacos";
```

Builds the metadata object for Nacos instance registration.

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

Creates a timestamped backup of the active OpenClaw config file.

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

Deep-merges two plain objects. Arrays and primitives from source replace target.

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

Recursively expands `${VAR}` and `${VAR:default}` placeholders in string values.

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

Parses plugin entry config into a discriminated union result.

```typescript
type ParsePluginConfigResult =
  | { kind: "skip"; reason: string }
  | { kind: "disabled" }
  | { kind: "ok"; config: NacosPluginConfig }
  | { kind: "error"; message: string };

function parseNacosPluginConfig(raw: unknown): ParsePluginConfigResult;
```

### Types

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

### Shared Constants

```typescript
import {
  DEFAULT_GROUP,      // "DEFAULT_GROUP"
  DEFAULT_NAMESPACE,  // "public"
  DEFAULT_SERVICE,    // "openclaw-gateway"
} from "@partme.ai/openclaw-nacos";
```
