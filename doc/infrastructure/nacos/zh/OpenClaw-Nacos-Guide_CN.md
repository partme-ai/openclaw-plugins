# 使用指南 — openclaw-nacos

## 前置条件

- **OpenClaw** ≥ 2026.4.6
- **Node.js** ≥ 22
- **Nacos Server** ≥ 2.0.3（推荐）

## 安装

### 从 npm 安装（推荐）

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

### 从本地构建安装

```bash
cd openclaw-nacos
pnpm build
npm pack
openclaw plugins install ./partme.ai-openclaw-nacos-2026.5.12.tgz
```

### 从源码安装（开发模式）

```bash
openclaw plugins install --link /path/to/openclaw-nacos
```

## 快速开始

### 1. 启动 Nacos Server

```bash
docker run -d --name nacos \
  -e MODE=standalone \
  -p 8848:8848 -p 9848:9848 \
  nacos/nacos-server:v2.4.0
```

### 2. 配置插件

在 `~/.openclaw/openclaw.json` 中添加：

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

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

### 4. 验证注册

```bash
curl "http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
```

或访问 http://localhost:8848/nacos → 服务管理 → 服务列表。

## 使用场景

### 场景 1：集中化配置管理

将完整的 `openclaw.json` 存储在 Nacos 中，所有 Gateway 实例自动加载。

**配置步骤**：
1. 在 Nacos 控制台创建配置，dataId 为 `openclaw.json`，group 为 `DEFAULT_GROUP`
2. 粘贴完整的 openclaw.json 内容
3. 配置插件：

```jsonc
"configCenter": {
  "enabled": true,
  "primaryConfigDataId": "openclaw.json"
}
```

**行为**：启动时 Gateway 先加载本地配置，然后 Nacos 主配置替换基准配置，`sharedConfigs`/`pluginConfigIds` 在其上叠加。Nacos 配置变更时自动触发重新同步并备份。

### 场景 2：多环境插件配置

按环境（dev/staging/prod）管理插件专属配置。

**Nacos 配置列表**：
```
openclaw-weixin-dev.json     →  { "appId": "dev-app", ... }
openclaw-weixin-prod.json    →  { "appId": "prod-app", ... }
openclaw-dingtalk-dev.json   →  { "appKey": "dev-key", ... }
```

**插件配置**：
```jsonc
"configCenter": {
  "enabled": true,
  "pluginConfigIds": ["openclaw-weixin", "openclaw-dingtalk"],
  "profile": "dev"
}
```

配置自动合并到 `plugins.entries["openclaw-weixin"].config`。

### 场景 3：Webhook 集群服务发现

运行多个 Gateway 实例，由 Nacos 提供服务发现能力。

**配置**：每个实例配置相同：

```jsonc
{
  "serverList": "nacos-cluster:8848",
  "username": "nacos",
  "password": "nacos",
  "serviceName": "openclaw-gateway",
  "registerIp": "10.0.0.12",   // 每个实例唯一
  "metadata": { "env": "prod" }
}
```

**外部服务**可通过 Nacos SDK 发现 Gateway 实例：

```python
# Python 示例
from nacos_sdk_python import NacosNamingService
naming = NacosNamingService.create_naming_service(config)
instances = await naming.list_instances("openclaw-gateway", "DEFAULT_GROUP")
for inst in instances:
    webhook_url = f"http://{inst.ip}:{inst.port}{inst.metadata['hooksBasePath']}"
```

### 场景 4：Spring Cloud Alibaba 兼容

对从 Spring Cloud Alibaba 迁移的团队，使用 Spring 风格的 `nacos` 配置块。

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

## 运维操作

### 健康检查

```bash
# Gateway 健康检查（包含 Nacos 状态）
curl http://localhost:18789/health

# Nacos 插件健康检查（组件级别）
curl http://localhost:18789/nacos/health
# → { "status": "ok", "configSync": {...}, "naming": {...}, "clusterDiscovery": {...} }
```

### 集群状态

```bash
curl http://localhost:18789/nacos/cluster
# → { "peers": [...], "peerCount": 2, "discoveryRunning": true }
```

### Nacos 注册状态

```bash
curl "http://localhost:8848/nacos/v1/ns/instance/list?serviceName=openclaw-gateway"
# → 返回已注册实例的 JSON 数组，包含 IP、端口、健康状态、元数据
```

### 配置备份恢复

备份文件存储在 OpenClaw 状态目录：

```bash
ls ~/.openclaw/openclaw-nacos-*.json
# openclaw-nacos-20260518140522.json
# openclaw-nacos-20260518143015.json

# 恢复备份：
cp openclaw-nacos-20260518140522.json ~/.openclaw/openclaw.json
openclaw gateway restart
```

## 故障排查

### 插件未加载

检查 gateway 日志中插件加载错误：
```bash
tail -100 ~/.openclaw/logs/gateway.log | grep -i nacos
```

验证插件已安装：
```bash
ls ~/.openclaw/extensions/openclaw-nacos/dist/index.js
```

### 注册信息未在 Nacos 中显示

1. 验证 Nacos 服务可达：`curl http://localhost:8848/nacos/v1/console/health/readiness`
2. 检查 `registerIp` 配置是否正确
3. 检查 `serverList` 指向的 Nacos 地址是否正确
4. 在 gateway 日志中查看注册错误

### 配置未同步

1. 确认 `configCenter.enabled` 为 `true`
2. 检查 dataId 和 group 与 Nacos 中的是否匹配
3. 验证命名空间隔离（configCenter.namespace 与顶层 namespace）
4. 如果启用了 Nacos 认证，检查凭据

### 实例 IP 显示 127.0.0.1

插件会尝试自动检测局域网 IP。如果未找到非回环 IPv4 地址，则回退到 `127.0.0.1`。显式设置 `registerIp`：

```jsonc
"registerIp": "192.168.1.100"
```

或设置环境变量：
```bash
export OPENCLAW_NACOS_REGISTER_IP=192.168.1.100
```

## 测试

```bash
# 单元测试
pnpm test

# 监视模式
pnpm test:watch

# 类型检查
pnpm typecheck

# 构建
pnpm build
```
