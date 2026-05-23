# Technical Details — openclaw-nacos

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | ≥ 22 |
| Language | TypeScript | 5.7+ |
| Module System | ES Modules | — |
| Build | tsup | 8.x |
| Test | Vitest | 4.x |
| Nacos SDK | nacos (npm) | 2.6.1 |
| YAML Parser | yaml | 2.7.0 |
| OpenClaw SDK | openclaw (peer) | ≥ 2026.4.6 |

## Nacos SDK Integration

### Transport Protocol

The `nacos@2.6.1` npm SDK uses **HTTP long polling** for communication with Nacos server. Unlike the Java/Go/Rust SDKs, the Node.js SDK does **not** support gRPC bidirectional streaming. This means:

- Config change detection has up to 30s latency (long poll timeout)
- Service instance changes are pushed via HTTP long polling
- No persistent gRPC connection overhead

### Two-Client Architecture

The plugin intentionally uses **separate** `NacosNamingClient` instances for registration and cluster discovery:

```
GatewayNacosRegistry ──► NacosNamingClient #1 (register/deregister)
WebhookClusterService ──► NacosNamingClient #2 (subscribe/getAllInstances)
```

**Rationale**: Each client maintains its own subscription state and lifecycle. If discovery encounters errors, the registration heartbeat continues unaffected. Both clients share the same `serverList`, `namespace`, and credentials.

### SDK Logger Adapter

The Nacos SDK expects a `console`-like logger. The plugin provides `createNacosSdkLogger()` which routes SDK log output through OpenClaw's plugin logger:

```typescript
function createNacosSdkLogger(log: PluginLog): typeof console {
  return {
    log: (...args) => log.info(String(args[0] ?? "")),
    info: (...args) => log.info(args.map(String).join(" ")),
    warn: (...args) => log.warn(args.map(String).join(" ")),
    error: (...args) => log.error(args.map(String).join(" ")),
    debug: (...args) => log.debug(args.map(String).join(" ")),
  } as typeof console;
}
```

Only the five methods known to be used by the SDK are overridden (not the full `console` spread).

## Config Sync Pipeline

### Merge Order

Configs from Nacos are applied in this order (later overrides earlier):

```
1. Current runtime config snapshot (or primaryConfigDataId if set)
2. sharedConfigs[0]
3. sharedConfigs[1]
4. ...
5. applicationDataId config
6. pluginConfigIds[0]
7. pluginConfigIds[1]
8. ...
9. Environment variable expansion (${VAR} placeholders)
10. Validation
11. Backup
12. Write to disk (replaceConfigFile)
```

### Backup Mechanism

Every config write triggered by a Nacos change is preceded by a backup:

```typescript
function backupOpenClawConfig(stateDir, env, logger) {
  const src = OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
  const stamp = formatTimestampYyyyMMddHHmmss(); // e.g. "20260518140522"
  const dest = path.join(stateDir, `openclaw-nacos-${stamp}.json`);
  copyFileSync(src, dest);
}
```

Backups accumulate indefinitely. Operators should periodically clean old backups.

### Validation

Before writing, the merged config is validated:

1. **JSON serializability**: `JSON.stringify()` check (note: silently drops `undefined`, converts `NaN` → `null`)
2. **Type check**: Must be a plain object (not null, not array)

When `skipValidation` is true, these checks are bypassed.

## Config Body Parsing

Nacos config bodies are parsed based on dataId extension and content:

| dataId pattern | Parser | Notes |
|---------------|--------|-------|
| `*.yml`, `*.yaml` | YAML (`yaml` package) | Forced YAML parse |
| Starts with `{` or `[` | JSON (`JSON.parse`) | Forced JSON parse |
| Other | JSON first, fallback to YAML | Content sniffing |

## Plugin Config Loading

### Per-Plugin Config Convention

Plugin configs follow the naming convention: `{pluginId}-{profile}.json`

Examples:
- `openclaw-weixin-dev.json`
- `openclaw-dingtalk-prod.json`
- `openclaw-lark-default.json`

The loaded config is merged into `plugins.entries[pluginId].config` in the OpenClaw config tree. Existing plugin config values are preserved and deep-merged with Nacos values.

### Profile Resolution

```
configCenter.profile
  → process.env.OPENCLAW_PROFILE
    → process.env.SPRING_PROFILES_ACTIVE
      → "default"
```

## Spring Cloud Alibaba Compatibility

The plugin accepts a nested `nacos` config block using Spring-style keys (kebab-case):

```jsonc
"nacos": {
  "server-addr": "...",       // → serverList
  "discovery": {
    "server-addr": "...",     // → namingServerList
    "namespace": "..."        // → namespace
  },
  "config": {
    "shared-configs": [       // → configCenter.sharedConfigs
      { "data-id": "..." }    // → dataId
    ]
  }
}
```

The `flattenSpringNacosPluginConfig()` function normalizes this block into flat keys before validation. **Top-level flat keys always take precedence** over nested `nacos.*` values when both are set.

## IP Resolution

The registration IP follows this priority chain:

```typescript
function resolveRegisterIp(params) {
  // 1. Explicit config
  if (params.configIp) return params.configIp;

  // 2. Environment variable
  const fromEnv = process.env.OPENCLAW_NACOS_REGISTER_IP;
  if (fromEnv) return fromEnv;

  // 3. First non-loopback IPv4
  const lan = pickFirstNonInternalIPv4(); // walks os.networkInterfaces()
  if (lan) return lan;

  // 4. Fallback (with warning)
  warn("falling back to 127.0.0.1");
  return "127.0.0.1";
}
```

## Port Resolution

```typescript
function resolveGatewayPort(cfg, env) {
  // 1. OPENCLAW_GATEWAY_PORT env (supports "port", "host:port", "[::1]:port")
  const envPort = parseGatewayPortEnvValue(env.OPENCLAW_GATEWAY_PORT);
  if (envPort) return envPort;

  // 2. Config
  if (cfg?.gateway?.port > 0) return cfg.gateway.port;

  // 3. Default
  return 18789;
}
```

## Error Handling Strategy

### Service-Level Errors

Each service catches errors in its `start()` method and:
1. Sets the relevant `healthState` flag to `false`
2. Stores sanitized error message in `healthState.lastError`
3. Logs the full error internally
4. Sets the service reference to `null` (preventing further operations)

### Teardown Errors

Errors during `stop()` / unsubscribe / close are caught and logged at debug level. They are intentionally non-fatal since teardown failures cannot be recovered.

### HTTP Response Errors

Error messages exposed via `/nacos/health` are sanitized to remove:
- File system paths (replaced with `[path]`)
- IPv4 addresses (replaced with `[ip]`)

## Test Coverage

| Source File | Test File | Tests |
|------------|-----------|-------|
| `config-parse.ts` | `config-parse.test.ts` | 9 |
| `env-expand.ts` | `env-expand.test.ts` | 2 |
| `format-timestamp.ts` | `format-timestamp.test.ts` | 2 |
| `merge-deep.ts` | `merge-deep.test.ts` | 3 |
| `nacos-cluster.ts` | `nacos-cluster.test.ts` | 7 |
| `nacos-config-sync.ts` | `nacos-config-sync.test.ts` | 17 |
| `nacos-connection.ts` | `nacos-connection.test.ts` | 12 |
| `nacos-registry.ts` | `nacos-registry.test.ts` | 3 |
| `resolve-endpoint.ts` | `resolve-endpoint.test.ts` | 8 |
| `spring-normalize.ts` | `spring-normalize.test.ts` | 8 |
| **Total** | | **72** |

Files without dedicated tests: `index.ts`, `setup-entry.ts`, `parse-config-content.ts`, `shared.ts`.
