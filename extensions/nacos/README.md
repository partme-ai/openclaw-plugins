<div align="center">

# OpenClaw Nacos

**OpenClaw plugin — Nacos Config Center merge and Gateway / Hooks naming registration**

![npm](https://img.shields.io/badge/npm-2026.5.12-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![Nacos](https://img.shields.io/badge/Nacos-SDK-orange)

</div>

[English](https://github.com/partme-ai/openclaw-plugins/tree/main/extensions/nacos/README.md) | [简体中文](https://github.com/partme-ai/openclaw-plugins/tree/main/extensions/nacos/README_CN.md)

## 📖 Introduction

**OpenClaw Nacos** (`@partme.ai/openclaw-nacos`) is a plugin for [OpenClaw](https://github.com/openclaw/openclaw) that integrates [Nacos](https://nacos.io/) using the official Node.js SDK [`nacos`](https://github.com/nacos-group/nacos-sdk-nodejs). After the Gateway is up, it provides **Naming** (Gateway / Hooks service discovery) and optional **Config Center** (pull remote config, deep-merge with the live config, backup before `writeConfigFile`, subscribe to changes). See [OpenClaw docs](https://docs.openclaw.ai) for the host runtime.

### 🎯 Core capabilities

#### **Naming**

- Registers the current node as an **ephemeral** instance via `NacosNamingClient` so consumers can resolve **IP + port** (same as the Gateway port, including [Hooks](https://docs.openclaw.ai) / webhook metadata).
- Port resolution matches OpenClaw: `OPENCLAW_GATEWAY_PORT` → `gateway.port` → default `18789`.

#### **Config Center (optional)**

- Uses `NacosConfigClient` to load config from Nacos. Two modes:
  - **Primary config mode** (`primaryConfigDataId`): Load the **complete** `openclaw.json` from a single Nacos dataId as the source of truth. `sharedConfigs` and `pluginConfigIds` are still layered on top.
  - **Shared configs mode** (`sharedConfigs`): Pull multiple partial configs and deep-merge them with the current runtime config.
- Supports optional `applicationDataId` and per-plugin `<pluginId>-<profile>.json` via `pluginConfigIds`.
- Before `runtime.config.replaceConfigFile`, backs up the active config file under `stateDir` as `openclaw-nacos-<yyyyMMddHHmmss>.json`.
- Subscribes to Nacos config changes and **re-applies** on every change (pull → merge → backup → write).
- Naming and Config share **`serverList` / `username` / `password` / default `namespace`**; Config may override with **`configCenter.namespace`**.

#### **Webhook Cluster Discovery (NEW)**

- Discovers peer Gateway nodes registered under the same Nacos service name.
- Maintains an in-memory peer list that **auto-updates** via Nacos naming subscription.
- Exposes `GET /nacos/cluster` HTTP endpoint with full peer metadata (IP, port, hooks path, health status).
- `GET /nacos/health` includes cluster discovery status and peer count.

### ✨ Highlights

#### 1. Naming and metadata

- **IP / port**: `registerIp` → `OPENCLAW_NACOS_REGISTER_IP` → first non-loopback IPv4 → `127.0.0.1` (with a warning).
- **Metadata**: `hooksEnabled`, `hooksBasePath`, `gatewayPort`, `provider`, plus custom `metadata` — **do not** put `hooks.token` or secrets here.

#### 2. Merge and placeholders

- Nacos bodies may be **JSON** or **YAML** (parsed with the `yaml` package).
- After merge, string values support **`${VAR}`** and **`${VAR:default}`** expansion from the environment.

#### 3. Backup and write

- Backup source: `OPENCLAW_CONFIG_PATH` if set, else `stateDir/openclaw.json`.
- Backup file: `stateDir/openclaw-nacos-<yyyyMMddHHmmss>.json` (local 14-digit timestamp).

#### 4. Switches

| **Switch** | **Behavior** |
| --- | --- |
| `enabled: false` | Disables the entire plugin |
| `naming.enabled: false` | Skips naming only; Config Center may still run |
| `configCenter.enabled: true` | Enables pull, merge, subscribe, and write |
| `clusterDiscovery.enabled: false` | Skips peer discovery only; naming registration still runs |

#### 5. Webhook cluster

- **Auto-discovery**: Subscribe to Nacos naming changes → maintain live peer list.
- **HTTP API**: `GET /nacos/cluster` returns all peers with IP, port, hooks metadata.
- **Health**: `GET /nacos/health` includes `clusterDiscovery.running` and peer count.
- **Self-filtering**: The local node is excluded from the peer list automatically.

### 🏗️ Conceptual flow

```
┌──────────────────────────────────────────────────────────────────┐
│                 OpenClaw (Gateway listening)                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ Nacos Naming │ │ Nacos Config │ │ Cluster Discovery│
│ register +   │ │ pull→merge→ │ │ subscribe naming │
│ Hooks meta   │ │ backup→write│ │ → live peer list │
└──────────────┘ └──────┬───────┘ └──────────────────┘
                        │
                        ▼
               subscribe → re-pull / merge
```

**Startup order**: OpenClaw loads local `openclaw.json` and starts the Gateway first; this plugin runs **after** that. The first Nacos merge is a **second convergence**. Bootstrapping **only** from Nacos before `loadConfig` requires OpenClaw core support.

### 📖 Quick start

#### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) **2026.4.6+** (see `peerDependencies` and `openclaw.compat` / `openclaw.build` in `package.json`)
- **Node.js 22+** ([Building plugins](https://docs.openclaw.ai/plugins/building-plugins) prerequisites; also in `engines`)
- **Nacos Server** reachable from the Gateway host (compatible with [nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs))

#### 1. Install with OpenClaw CLI (recommended)

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

This typically:

- Downloads the package from npm
- Installs it under your OpenClaw extensions directory (e.g. `~/.openclaw/extensions/`)
- Updates your OpenClaw config so the plugin can be enabled

Then enable and configure the plugin under `plugins.entries` (see below). Exact CLI behavior depends on your OpenClaw version; see [OpenClaw documentation](https://docs.openclaw.ai).

#### 2. Install with npm (manual / advanced)

```bash
npm install @partme.ai/openclaw-nacos
```

Wire the package into OpenClaw using your version’s plugin discovery rules (`openclaw.plugin.json`, `plugins.entries`, paths).

#### Spring-style `nacos` block (optional)

You may nest a `nacos` object under `plugins.entries.openclaw-nacos.config` (similar to Spring Boot `application.yml`). The plugin flattens it before validation; **top-level keys win** when both are present. See [README_CN.md](./README_CN.md) for field mapping (`server-addr`, `discovery`, `config`, `shared-configs`, `data-id`).

#### npm `nacos` 2.x only

This plugin targets the official npm package [`nacos`](https://www.npmjs.com/package/nacos) **v2** ([nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs)). Older major lines are not supported.

#### OpenClaw plugin conventions

- `package.json` includes the full **`openclaw`** block from [Building plugins](https://docs.openclaw.ai/plugins/building-plugins): `extensions` (this published package points to **`./dist/index.js`**; the doc quickstart uses `./index.ts` for source-first layouts), **`compat.pluginApi`**, **`compat.minGatewayVersion`**, and **`build.openclawVersion` / `build.pluginSdkVersion`**.
- Entry uses [`definePluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints) from `openclaw/plugin-sdk/plugin-entry` (focused subpath; avoid the deprecated monolithic `openclaw/plugin-sdk` root import).
- Nacos clients start only when [`registrationMode === "full"`](https://docs.openclaw.ai/plugins/sdk-entrypoints#registration-mode), matching the doc guidance for long-lived services.
- Config merge uses [`api.runtime.config.loadConfig` / `writeConfigFile`](https://docs.openclaw.ai/plugins/sdk-runtime); `loadConfig` may be async per docs.
- Reload hints use the plugin definition **`reload`** field (same semantics as `OpenClawPluginReloadRegistration` in the [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)).

#### Config reload

The plugin sets `reload: { restartPrefixes, hotPrefixes }` on the entry object so Gateway reload planning after a Nacos-driven `writeConfigFile` can classify changes (restart vs hot) consistently with OpenClaw core.

#### 3. Minimal example (naming only)

Edit your OpenClaw config (often `~/.openclaw/openclaw.json` or `OPENCLAW_CONFIG_PATH`):

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

#### 3a. Complete config from Nacos (primaryConfigDataId)

Store your **entire** `openclaw.json` as a Nacos config (e.g. dataId `openclaw.json`, group `DEFAULT_GROUP`), then use `primaryConfigDataId` to load it as the source of truth. `sharedConfigs` and `pluginConfigIds` are still layered on top.

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          "serverList": "127.0.0.1:8848",
          "configCenter": {
            "enabled": true,
            "primaryConfigDataId": "openclaw.json",
            "primaryConfigGroup": "DEFAULT_GROUP",
            "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],
            "profile": "dev"
          }
        }
      }
    }
  }
}
```

With this setup:
- The **primary config** (`openclaw.json` in Nacos) replaces the local config snapshot as the base.
- `openclaw-weixin-dev.json` and `openclaw-dingtalk-dev.json` are loaded into `plugins.entries["openclaw-weixin"].config` etc.
- Any Nacos config change triggers: pull → merge → **backup** (`openclaw-nacos-yyyyMMddHHmmss.json`) → write.

#### 3b. Webhook cluster with peer discovery

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-nacos": {
        "enabled": true,
        "config": {
          "serverList": "127.0.0.1:8848",
          "serviceName": "openclaw-gateway",
          "registerIp": "10.0.0.12",
          "metadata": { "env": "prod", "region": "us-east-1" }
        }
      }
    }
  }
}
```

After startup:
- `GET /nacos/cluster` → `{ "peers": [...], "peerCount": 2, "discoveryRunning": true }`
- `GET /nacos/health` → `{ "status": "ok", "clusterDiscovery": { "running": true } }`

#### 4. Build and test (from this repository)

```bash
pnpm install
pnpm run build
pnpm test
```

### 📁 Project structure

```
openclaw-nacos/
├── src/
│   ├── index.ts              # Plugin entry (register services, HTTP routes)
│   ├── nacos-registry.ts     # Nacos Naming (Gateway / Hooks)
│   ├── nacos-config-sync.ts  # Nacos Config (merge, backup, subscribe, primary)
│   ├── nacos-cluster.ts      # Webhook cluster discovery
│   ├── shared.ts             # Shared constants & utilities
│   ├── types.ts
│   └── ...
├── docs/
│   ├── ARCHITECTURE.md       # System architecture & design
│   ├── CONFIG.md             # Complete configuration reference
│   ├── GUIDE.md              # Usage guide & use cases
│   ├── API.md                # HTTP endpoints & exported API
│   └── TECHNICAL.md          # Technical details & design decisions
├── dist/                     # Published build output
├── openclaw.plugin.json      # OpenClaw plugin manifest
├── package.json
└── README.md / README_CN.md
```

### 📚 Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, modules, data flow
- [Configuration](docs/CONFIG.md) — Full config schema and field reference
- [Usage Guide](docs/GUIDE.md) — Quick start, use cases, troubleshooting
- [API Reference](docs/API.md) — HTTP endpoints, CLI, exported modules
- [Technical Details](docs/TECHNICAL.md) — Tech stack, SDK integration, design decisions

### ❓ FAQ

#### Q: Does Nacos replace my local `openclaw.json` on startup?

**A:** No. OpenClaw still loads local config first and starts the Gateway; this plugin runs afterward. Config Center merges remote config into the live config and can persist via `writeConfigFile` — a **second convergence**. Full “Nacos-only before first load” would require OpenClaw core support.

#### Q: How do I use the webhook cluster feature?

**A:** When `naming` is enabled (the default), the plugin automatically starts cluster discovery. It subscribes to the same Nacos service name used for registration and maintains a live peer list. Access `GET /nacos/cluster` for the current cluster state including all peer IPs, ports, and hooks metadata. External services can discover webhook nodes via Nacos SDK using the registered service name. Self-filtering excludes the local node from the peer list.

#### Q: Is Gateway auth (`gateway.auth.token`) required for Nacos discovery?

**A:** **Naming** only registers IP/port and metadata for other services. Consumers still call Hooks using your normal OpenClaw auth. Do **not** put `hooks.token` or Gateway secrets into Nacos metadata or config bodies.

#### Q: Where are CI build artifacts?

**A:** On each push/PR, [GitHub Actions](https://github.com/partme-ai/openclaw-nacos/actions) runs `ci.yml` and uploads the **`dist/`** folder as a workflow artifact (`openclaw-nacos-dist`).

### 🤖 GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Push / PR to `main` or `master` | `pnpm install --frozen-lockfile`, typecheck, build, test, upload `dist/` artifact |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | Push tag `v*` (`publish`); **Run workflow** runs package job only | Build, test, `npm publish` to npmjs.org (skips if version exists), **GitHub Packages** as `@<github-owner>/openclaw-nacos` (e.g. `@partme-ai/...`), **GitHub Release** with `.tgz` |

**Release setup:** add repository secret **`NPM_TOKEN`** (see [RELEASING.md](./RELEASING.md)). Creating a tag:

```bash
pnpm version patch   # or minor / major
git push origin main --follow-tags
```

### 📝 Configuration

#### Required

| **Field** | **Description** |
| --- | --- |
| `serverList` | Nacos address, e.g. `host:8848` or comma-separated list |

#### Naming (optional)

| **Field** | **Default** | **Description** |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the **entire** plugin |
| `naming.enabled` | `true` | `false` skips naming only |
| `namespace` | `public` | Namespace; default for Config if `configCenter.namespace` unset |
| `username` / `password` | — | Nacos auth (shared by Naming and Config) |
| `serviceName` | `openclaw-gateway` | Service name |
| `groupName` | `DEFAULT_GROUP` | Group |
| `clusterName` | — | Cluster name |
| `weight` | `1` | Weight |
| `ephemeral` | `true` | Ephemeral instance |
| `registerIp` | env / auto | IP registered to Nacos |
| `metadata` | — | Extra metadata (string map) |

#### Config Center `configCenter` (optional)

| **Field** | **Description** |
| --- | --- |
| `configCenter.enabled` | When `true`, enables pull, merge, subscribe, write |
| `configCenter.namespace` | Config tenant; overrides top-level `namespace` for Config only |
| `configCenter.sharedConfigs` | Ordered `{ dataId, group?, refresh? }` list, merged in order |
| `configCenter.applicationDataId` | Optional main dataId (supports `${profile}` in templates) |
| `configCenter.profile` | Profile for dataIds and `<pluginId>-<profile>.json` |
| `configCenter.pluginConfigIds` | Plugin IDs; merge into `plugins.entries.<id>.config` |
| `configCenter.skipValidation` | When `true`, skips extra plugin-side checks (JSON serializable checks still apply) |

#### Environment variables

| **Variable** | **Purpose** |
| --- | --- |
| `OPENCLAW_GATEWAY_PORT` | Overrides Gateway port resolution |
| `OPENCLAW_NACOS_REGISTER_IP` | Advertised IP if `registerIp` unset |
| `OPENCLAW_CONFIG_PATH` | If set, this file is copied before `writeConfigFile` |
| `OPENCLAW_PROFILE` | Profile (overridden by `configCenter.profile`) |
| `SPRING_PROFILES_ACTIVE` | Used if `OPENCLAW_PROFILE` unset |

### 🔒 Security

- **`writeConfigFile` is powerful** — enable Config Center only in trusted environments; never store `hooks.token` or secrets in Nacos bodies or metadata.
- After discovery, call Hooks with normal OpenClaw auth headers; **never** treat Nacos metadata as a secret channel.

### 🌐 Consumer flow (other services)

1. Subscribe to the service name in Nacos.
2. Pick an instance (IP + port).
3. Build Hooks URL: `http://<ip>:<port><hooksBasePath>/...` with OpenClaw auth headers.

### 🛠️ Tech stack

| **Area** | **Details** |
| --- | --- |
| Runtime | Node.js 22+, ESM |
| SDK | [`nacos`](https://github.com/nacos-group/nacos-sdk-nodejs) (Naming + Config) |
| Parsing | `yaml` for YAML config bodies |
| Host | OpenClaw plugin API (`registerService`, `runtime.config`) |

### 📦 Version

| **Item** | **Version** |
| --- | --- |
| @partme.ai/openclaw-nacos | 2026.5.12.2 |
| Recommended Node | 22+ |

### 🔗 Links

| **Resource** | **URL** |
| --- | --- |
| Nacos | [https://nacos.io](https://nacos.io) |
| nacos-sdk-nodejs | [https://github.com/nacos-group/nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs) |
| OpenClaw | [https://docs.openclaw.ai](https://docs.openclaw.ai) |
| OpenClaw (source) | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| 中文说明 | [README_CN.md](./README_CN.md) |

#### OpenClaw plugins (official docs)

| **Topic** | **URL** |
| --- | --- |
| Plugins | [https://docs.openclaw.ai/tools/plugin](https://docs.openclaw.ai/tools/plugin) |
| Community plugins | [https://docs.openclaw.ai/plugins/community](https://docs.openclaw.ai/plugins/community) |
| Bundles | [https://docs.openclaw.ai/plugins/bundles](https://docs.openclaw.ai/plugins/bundles) |
| Voice call | [https://docs.openclaw.ai/plugins/voice-call](https://docs.openclaw.ai/plugins/voice-call) |

#### Building plugins

| **Topic** | **URL** |
| --- | --- |
| Building plugins | [https://docs.openclaw.ai/plugins/building-plugins](https://docs.openclaw.ai/plugins/building-plugins) |
| SDK channel plugins | [https://docs.openclaw.ai/plugins/sdk-channel-plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins) |
| SDK provider plugins | [https://docs.openclaw.ai/plugins/sdk-provider-plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins) |
| SDK migration | [https://docs.openclaw.ai/plugins/sdk-migration](https://docs.openclaw.ai/plugins/sdk-migration) |

#### SDK reference

| **Topic** | **URL** |
| --- | --- |
| SDK overview | [https://docs.openclaw.ai/plugins/sdk-overview](https://docs.openclaw.ai/plugins/sdk-overview) |
| SDK entrypoints | [https://docs.openclaw.ai/plugins/sdk-entrypoints](https://docs.openclaw.ai/plugins/sdk-entrypoints) |
| SDK runtime | [https://docs.openclaw.ai/plugins/sdk-runtime](https://docs.openclaw.ai/plugins/sdk-runtime) |
| SDK setup | [https://docs.openclaw.ai/plugins/sdk-setup](https://docs.openclaw.ai/plugins/sdk-setup) |
| SDK testing | [https://docs.openclaw.ai/plugins/sdk-testing](https://docs.openclaw.ai/plugins/sdk-testing) |
| Manifest | [https://docs.openclaw.ai/plugins/manifest](https://docs.openclaw.ai/plugins/manifest) |
| Architecture | [https://docs.openclaw.ai/plugins/architecture](https://docs.openclaw.ai/plugins/architecture) |

### 📄 License

This project is licensed under the [MIT License](LICENSE).

### 🙏 Acknowledgements

- [Nacos](https://nacos.io)
- [nacos-sdk-nodejs](https://github.com/nacos-group/nacos-sdk-nodejs)
- [OpenClaw](https://docs.openclaw.ai)

---

<div align="center">

**If this project helps you, consider giving it a ⭐️**

Made with ❤️ by PartMe

</div>
