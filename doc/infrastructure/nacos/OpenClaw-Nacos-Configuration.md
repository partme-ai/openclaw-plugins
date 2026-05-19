# Configuration Reference — openclaw-nacos

## Plugin Entry

All configuration lives under `plugins.entries["openclaw-nacos"].config` in `openclaw.json`.

## Full Schema

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          // ── Connection ──────────────────────────────────
          "serverList": "127.0.0.1:8848",         // Required: Nacos server address(es)
          "namingServerList": "10.0.0.1:8848",     // Optional: separate Naming address
          "configServerList": "10.0.0.2:8848",     // Optional: separate Config address
          "namespace": "public",                    // Namespace (tenant isolation)
          "username": "nacos",                      // Nacos auth username
          "password": "nacos",                      // Nacos auth password

          // ── Naming Registration ────────────────────────
          "serviceName": "openclaw-gateway",        // Service name in Nacos
          "groupName": "DEFAULT_GROUP",             // Service group
          "clusterName": "default",                 // Optional cluster label
          "weight": 1.0,                            // Load-balancing weight
          "ephemeral": true,                        // Ephemeral (heartbeat) instance
          "registerIp": "192.168.1.100",            // Explicit IP override
          "metadata": {                              // Custom instance metadata
            "env": "prod",
            "region": "us-east-1"
          },

          // ── Naming Toggle ──────────────────────────────
          "naming": {
            "enabled": true                          // false = skip registration only
          },

          // ── Config Center ──────────────────────────────
          "configCenter": {
            "enabled": true,                         // Enable config sync
            "namespace": "config-ns",                // Override namespace for Config only

            // Primary config (complete openclaw.json from Nacos)
            "primaryConfigDataId": "openclaw.json",
            "primaryConfigGroup": "DEFAULT_GROUP",

            // Shared configs (deep-merged in order)
            "sharedConfigs": [
              { "dataId": "base.yml", "group": "DEFAULT_GROUP", "refresh": true },
              { "dataId": "override.json", "refresh": false }
            ],

            // Application config (supports ${profile} template)
            "applicationDataId": "application-${profile}.json",

            // Per-plugin configs (auto-fetch {pluginId}-{profile}.json)
            "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],

            // Profile (default: OPENCLAW_PROFILE → SPRING_PROFILES_ACTIVE → "default")
            "profile": "dev",

            // Bypass validation (dangerous)
            "skipValidation": false
          },

          // ── Cluster Discovery ──────────────────────────
          "clusterDiscovery": {
            "enabled": true                          // false = skip peer discovery
          },

          // ── Spring-style nesting (alternative) ────────
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

## Field Reference

### Connection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `serverList` | string | **required** | Comma-separated Nacos addresses, e.g. `"host1:8848,host2:8848"` |
| `namingServerList` | string | `serverList` | Separate address for Naming client |
| `configServerList` | string | `serverList` | Separate address for Config client |
| `namespace` | string | `"public"` | Nacos namespace (tenant isolation) |
| `username` | string | — | Nacos auth username |
| `password` | string | — | Nacos auth password |

### Naming Registration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `serviceName` | string | `"openclaw-gateway"` | Registered service name |
| `groupName` | string | `"DEFAULT_GROUP"` | Service group |
| `clusterName` | string | — | Instance cluster label |
| `weight` | number | `1.0` | Load-balancing weight |
| `ephemeral` | boolean | `true` | Ephemeral instance (heartbeat-based) |
| `registerIp` | string | auto-detect | Explicit IP to register |
| `metadata` | object | — | Custom key-value metadata |
| `naming.enabled` | boolean | `true` | Set `false` to skip registration |

### Config Center

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `configCenter.enabled` | boolean | `false` | Enable config sync from Nacos |
| `configCenter.namespace` | string | top-level `namespace` | Config-only namespace override |
| `configCenter.primaryConfigDataId` | string | — | Single dataId holding complete `openclaw.json` |
| `configCenter.primaryConfigGroup` | string | `"DEFAULT_GROUP"` | Group for primary config |
| `configCenter.sharedConfigs` | array | — | Ordered list of partial configs to merge |
| `configCenter.applicationDataId` | string | — | Application-level config dataId (supports `${profile}`) |
| `configCenter.pluginConfigIds` | array | — | Plugin IDs to fetch configs for |
| `configCenter.profile` | string | env → `"default"` | Active profile for config file naming |
| `configCenter.skipValidation` | boolean | `false` | Skip pre-write validation (dangerous) |

### Cluster Discovery

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `clusterDiscovery.enabled` | boolean | `true` | Set `false` to skip peer discovery |

## Environment Variables

| Variable | Purpose | Priority |
|----------|---------|----------|
| `OPENCLAW_GATEWAY_PORT` | Gateway listen port | Overrides `gateway.port` |
| `OPENCLAW_NACOS_REGISTER_IP` | IP to register in Nacos | Overridden by `registerIp` config |
| `OPENCLAW_PROFILE` | Active profile for config naming | Overridden by `profile` config |
| `SPRING_PROFILES_ACTIVE` | Spring-style profile fallback | Lowest priority |
| `OPENCLAW_CONFIG_PATH` | Path to openclaw.json (for backup) | Config file location |

## Config Precedence

### Server Address

```
namingServerList / configServerList > serverList
nacos.discovery.server-addr > nacos.server-addr
Top-level flat keys > Spring-style nacos.* nested keys
```

### Config Center Namespace

```
configCenter.namespace > top-level namespace > "public"
```

### Register IP

```
registerIp config > OPENCLAW_NACOS_REGISTER_IP env > first LAN IPv4 > 127.0.0.1
```

### Profile

```
configCenter.profile > OPENCLAW_PROFILE env > SPRING_PROFILES_ACTIVE env > "default"
```

## Minimal Examples

### Naming Only (Service Discovery)

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

### Config Center with Primary Config

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

### Full Production Setup

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
