# Usage Guide — openclaw-nacos

## Prerequisites

- **OpenClaw** ≥ 2026.4.6
- **Node.js** ≥ 22
- **Nacos Server** ≥ 2.0.3 (recommended)

## Installation

### From npm (Recommended)

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

### From Local Build

```bash
cd openclaw-nacos
pnpm build
npm pack
openclaw plugins install ./partme.ai-openclaw-nacos-2026.5.12.tgz
```

### From Source (Development)

```bash
openclaw plugins install --link /path/to/openclaw-nacos
```

## Quick Start

### 1. Start Nacos Server

```bash
docker run -d --name nacos \
  -e MODE=standalone \
  -p 8848:8848 -p 9848:9848 \
  nacos/nacos-server:v2.4.0
```

### 2. Configure Plugin

Add to `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          "serverList": "127.0.0.1:8848",
          "username": "nacos",
          "password": "nacos",
          "serviceName": "openclaw-gateway"
        }
      }
    }
  }
}
```

### 3. Restart Gateway

```bash
openclaw gateway restart
```

### 4. Verify Registration

```bash
curl "http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
```

Or visit http://localhost:8848/nacos → Service Management → Service List.

## Use Cases

### Use Case 1: Centralized Configuration Management

Store the complete `openclaw.json` in Nacos and have all Gateway instances load it automatically.

**Setup**:
1. In Nacos Console, create a config with dataId `openclaw.json`, group `DEFAULT_GROUP`
2. Paste your complete openclaw.json content
3. Configure the plugin:

```jsonc
"configCenter": {
  "enabled": true,
  "primaryConfigDataId": "openclaw.json"
}
```

**Behavior**: On startup, the Gateway loads its local config first, then the Nacos config replaces the base and any `sharedConfigs`/`pluginConfigIds` are layered on top. Config changes in Nacos trigger automatic re-sync with backup.

### Use Case 2: Multi-Environment Plugin Configs

Manage plugin-specific configs per environment (dev/staging/prod).

**Nacos Configs**:
```
openclaw-weixin-dev.json     →  { "appId": "dev-app", ... }
openclaw-weixin-prod.json    →  { "appId": "prod-app", ... }
openclaw-dingtalk-dev.json   →  { "appKey": "dev-key", ... }
```

**Plugin Config**:
```jsonc
"configCenter": {
  "enabled": true,
  "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],
  "profile": "dev"
}
```

Configs are auto-merged into `plugins.entries["openclaw-weixin"].config`.

### Use Case 3: Webhook Cluster with Service Discovery

Run multiple Gateway instances behind a load balancer, with Nacos providing service discovery.

**Setup**: Configure each instance identically:

```jsonc
{
  "serverList": "nacos-cluster:8848",
  "username": "nacos",
  "password": "nacos",
  "serviceName": "openclaw-gateway",
  "registerIp": "10.0.0.12",   // unique per instance
  "metadata": { "env": "prod" }
}
```

**External services** can discover Gateway instances via Nacos SDK:

```python
# Python example
from nacos_sdk_python import NacosNamingService
naming = NacosNamingService.create_naming_service(config)
instances = await naming.list_instances("openclaw-gateway", "DEFAULT_GROUP")
for inst in instances:
    webhook_url = f"http://{inst.ip}:{inst.port}{inst.metadata['hooksBasePath']}"
```

### Use Case 4: Spring Cloud Alibaba Compatibility

Use the Spring-style `nacos` block for teams migrating from Spring Cloud Alibaba.

```jsonc
"nacos": {
  "server-addr": "127.0.0.1:8848",
  "discovery": {
    "server-addr": "10.0.0.1:8848",
    "namespace": "dev"
  },
  "config": {
    "shared-configs": [
      { "data-id": "common.yml", "group": "DEFAULT_GROUP" }
    ]
  }
}
```

## Operations

### Health Check

```bash
# Gateway health (includes Nacos status)
curl http://localhost:18789/health

# Nacos plugin health (component-level)
curl http://localhost:18789/nacos/health
# → { "status": "ok", "configSync": {...}, "naming": {...}, "clusterDiscovery": {...} }
```

### Cluster Status

```bash
curl http://localhost:18789/nacos/cluster
# → { "peers": [...], "peerCount": 2, "discoveryRunning": true }
```

### Nacos Registration Status

```bash
curl "http://localhost:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
# → JSON array of registered instances with IP, port, health, metadata
```

### Config Backup Recovery

Backups are stored in the OpenClaw state directory:

```bash
ls ~/.openclaw/openclaw-nacos-*.json
# openclaw-nacos-20260518140522.json
# openclaw-nacos-20260518143015.json

# Restore a backup:
cp openclaw-nacos-20260518140522.json ~/.openclaw/openclaw.json
openclaw gateway restart
```

## Troubleshooting

### Plugin not loading

Check gateway log for plugin loading errors:
```bash
tail -100 ~/.openclaw/logs/gateway.log | grep -i nacos
```

Verify plugin is installed:
```bash
ls ~/.openclaw/extensions/openclaw-nacos/dist/index.js
```

### Registration not appearing in Nacos

1. Verify Nacos server is reachable: `curl http://localhost:8848/nacos/v1/console/health/readiness`
2. Check `registerIp` is correct for your network
3. Check `serverList` points to the correct Nacos address
4. Look for registration errors in the gateway log

### Config not syncing

1. Verify `configCenter.enabled` is `true`
2. Check dataId and group match what's in Nacos
3. Verify namespace isolation (configCenter.namespace vs top-level namespace)
4. Check Nacos auth credentials if enabled

### Instance shows 127.0.0.1

The plugin tries to auto-detect the LAN IP. If no non-loopback IPv4 is found, it falls back to `127.0.0.1`. Set `registerIp` explicitly:

```jsonc
"registerIp": "192.168.1.100"
```

Or set the environment variable:
```bash
export OPENCLAW_NACOS_REGISTER_IP=192.168.1.100
```

## Testing

```bash
# Unit tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Build
pnpm build
```
