# 技术细节 — openclaw-nacos

## 技术栈

| 组件 | 技术 | 版本 |
|-----------|-----------|---------|
| 运行时 | Node.js | ≥ 22 |
| 语言 | TypeScript | 5.7+ |
| 模块系统 | ES Modules | — |
| 构建 | tsup | 8.x |
| 测试 | Vitest | 4.x |
| Nacos SDK | nacos (npm) | 2.6.1 |
| YAML 解析 | yaml | 2.7.0 |
| OpenClaw SDK | openclaw (peer) | ≥ 2026.4.6 |

## Nacos SDK 集成

### 传输协议

`nacos@2.6.1` npm SDK 使用 **HTTP 长轮询**与 Nacos 服务端通信。与 Java/Go/Rust SDK 不同，Node.js SDK **不支持** gRPC 双向流。这意味着：

- 配置变更检测最多有 30 秒延迟（长轮询超时）
- 服务实例变更通过 HTTP 长轮询推送
- 无持久 gRPC 连接开销

### 双客户端架构

插件有意使用**独立**的 `NacosNamingClient` 实例分别用于注册和集群发现：

```
GatewayNacosRegistry ──► NacosNamingClient #1（注册/注销）
WebhookClusterService ──► NacosNamingClient #2（订阅/getAllInstances）
```

**设计理由**：每个客户端维护自己的订阅状态和生命周期。即使发现出现错误，注册心跳也不受影响。两个客户端共享相同的 `serverList`、`namespace` 和凭据。

### SDK 日志适配器

Nacos SDK 期望接收一个 `console` 风格的日志对象。插件提供 `createNacosSdkLogger()` 将 SDK 日志输出路由到 OpenClaw 的插件日志系统：

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

仅覆盖 SDK 已知会使用的五个方法（而非展开完整的 `console` 对象）。

## 配置同步管道

### 合并顺序

来自 Nacos 的配置按以下顺序应用（后者覆盖前者）：

```
1. 当前运行时配置快照（如果设置了 primaryConfigDataId 则用它替代）
2. sharedConfigs[0]
3. sharedConfigs[1]
4. ...
5. applicationDataId 配置
6. pluginConfigIds[0]
7. pluginConfigIds[1]
8. ...
9. 环境变量展开（${VAR} 占位符）
10. 验证
11. 备份
12. 写入磁盘（replaceConfigFile）
```

### 备份机制

每次由 Nacos 变更触发的配置写入前都会创建备份：

```typescript
function backupOpenClawConfig(stateDir, env, logger) {
  const src = OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
  const stamp = formatTimestampYyyyMMddHHmmss(); // 如 "20260518140522"
  const dest = path.join(stateDir, `openclaw-nacos-${stamp}.json`);
  copyFileSync(src, dest);
}
```

备份文件会累积增长，运维人员应定期清理旧备份。

### 验证

写入前对合并后的配置进行验证：

1. **JSON 可序列化**：`JSON.stringify()` 检查（注意：会静默丢弃 `undefined`，将 `NaN` 转换为 `null`）
2. **类型检查**：必须为纯对象（非 null、非数组）

当 `skipValidation` 为 true 时，跳过这些检查。

## 配置正文解析

Nacos 配置正文根据 dataId 扩展名和内容进行解析：

| dataId 模式 | 解析器 | 备注 |
|---------------|--------|-------|
| `*.yml`, `*.yaml` | YAML（`yaml` 包） | 强制 YAML 解析 |
| 以 `{` 或 `[` 开头 | JSON（`JSON.parse`） | 强制 JSON 解析 |
| 其他 | 先 JSON，失败回退 YAML | 内容嗅探 |

## 插件配置加载

### 按插件配置约定

插件配置遵循命名约定：`{pluginId}-{profile}.json`

示例：
- `openclaw-weixin-dev.json`
- `openclaw-dingtalk-prod.json`
- `openclaw-lark-default.json`

加载的配置合并到 OpenClaw 配置树中的 `plugins.entries[pluginId].config`。已有的插件配置值会被保留并与 Nacos 中的值深度合并。

### Profile 解析

```
configCenter.profile
  → process.env.OPENCLAW_PROFILE
    → process.env.SPRING_PROFILES_ACTIVE
      → "default"
```

## Spring Cloud Alibaba 兼容性

插件接受使用 Spring 风格键名（kebab-case）的嵌套 `nacos` 配置块：

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

`flattenSpringNacosPluginConfig()` 函数在验证前将配置块规范化为扁平键。**顶层扁平键始终优先于**嵌套的 `nacos.*` 值。

## IP 解析

注册 IP 按以下优先级链解析：

```typescript
function resolveRegisterIp(params) {
  // 1. 显式配置
  if (params.configIp) return params.configIp;

  // 2. 环境变量
  const fromEnv = process.env.OPENCLAW_NACOS_REGISTER_IP;
  if (fromEnv) return fromEnv;

  // 3. 首个非回环 IPv4
  const lan = pickFirstNonInternalIPv4(); // 遍历 os.networkInterfaces()
  if (lan) return lan;

  // 4. 回退（附警告）
  warn("回退到 127.0.0.1");
  return "127.0.0.1";
}
```

## 端口解析

```typescript
function resolveGatewayPort(cfg, env) {
  // 1. OPENCLAW_GATEWAY_PORT 环境变量（支持 "port"、"host:port"、"[::1]:port"）
  const envPort = parseGatewayPortEnvValue(env.OPENCLAW_GATEWAY_PORT);
  if (envPort) return envPort;

  // 2. 配置
  if (cfg?.gateway?.port > 0) return cfg.gateway.port;

  // 3. 默认
  return 18789;
}
```

## 错误处理策略

### 服务级错误

每个服务在其 `start()` 方法中捕获错误并：
1. 将对应 `healthState` 标志设为 `false`
2. 将脱敏后的错误信息存入 `healthState.lastError`
3. 内部记录完整错误日志
4. 将服务引用设为 `null`（阻止进一步操作）

### 清理错误

`stop()` / unsubscribe / close 期间的错误被捕获并在 debug 级别记录。它们被有意设为非致命，因为清理失败无法恢复。

### HTTP 响应中的错误信息

通过 `/nacos/health` 暴露的错误信息经脱敏处理，移除：
- 文件系统路径（替换为 `[path]`）
- IPv4 地址（替换为 `[ip]`）

## 测试覆盖

| 源文件 | 测试文件 | 测试数 |
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
| **合计** | | **72** |

无独立测试的文件：`index.ts`、`setup-entry.ts`、`parse-config-content.ts`、`shared.ts`。
