# OpenClaw Plugins — 快速开始

## 安装插件

每个插件独立安装：

```bash
# IM 渠道
openclaw plugins install @partme.ai/wecom

# 钉钉 / 飞书 / QQ 等官方上游渠道见 openclaw-bridge，例如：
# openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 基础设施
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/openclaw-prometheus

# 消息队列
openclaw plugins install @partme.ai/openclaw-mqtt
```

安装后重启 Gateway：

```bash
openclaw gateway restart
```

## 配置

每个插件有独立的配置指南，参见 [文档索引](./README.md#插件文档--plugin-docs)。通用配置模式：

```json
{
  "channels": {
    "<channel-id>": {
      "enabled": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "accounts": {
        "default": { "appId": "...", "appSecret": "..." }
      }
    }
  }
}
```

### 通用配置项

| 字段 | 说明 | 可选值 |
|------|------|--------|
| `enabled` | 通道开关 | `true` / `false` |
| `dmPolicy` | 私聊策略 | `open` / `pairing` / `allowlist` / `disabled` |
| `groupPolicy` | 群聊策略 | `open` / `allowlist` / `disabled` |
| `allowFrom` | 私聊白名单 | `["user1", "user2"]` |
| `accounts` | 多账号配置 | `{ "main": {...}, "support": {...} }` |
| `defaultAccount` | 默认账号 | `"main"` |

## 多账号

大多数插件支持多账号矩阵隔离：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "ops",
      "accounts": {
        "ops": { "botId": "bot-ops-xxx", "secret": "secret-ops" },
        "sales": { "botId": "bot-sales-xxx", "secret": "secret-sales" }
      }
    }
  }
}
```

不同 `accountId` 之间的会话、Agent、上下文完全隔离。

## 开发者

从源码构建：

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install
pnpm build
```

创建新插件：

```bash
pnpm new-plugin my-plugin --label "我的插件" --desc "插件描述"
```

详见 [OpenClaw-Plugins-Contributing_CN.md](./OpenClaw-Plugins-Contributing_CN.md)。
