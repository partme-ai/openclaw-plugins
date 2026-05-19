# openclaw-plugins

<p align="center">
  <strong>30+ Enterprise Plugins. One Standard.</strong><br>
  <sub>Built for production. Not for demos.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/search?q=%40partme.ai"><img src="https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

<p align="center">
  <sub>研发与二次开发 · 基于第三方开源项目 · 保留原始许可证</sub>
</p>

---

## 📦 Packages

### 📱 IM Channels
| Package | Description | License |
|---------|------------|---------|
| [@partme.ai/wecom](./extensions/wecom) | 企业微信 Bot + Agent 双模接入，多账号矩阵，20 Skills | ISC |
| [@partme.ai/dingtalk](./extensions/dingtalk) | 钉钉 Stream 模式机器人 | MIT |
| [@partme.ai/lark](./extensions/lark) | 飞书/Lark 企业消息 | MIT |
| [@partme.ai/qqbot](./extensions/qqbot) | QQ 机器人 | MIT |
| [@partme.ai/weixin](extensions/wechat) | 微信公众号 / 客服消息 | SEE LICENSE |
| [@partme.ai/wecom-kf](./extensions/wecom-kf) | 企业微信客服（外部微信用户） | MIT |
| [@partme.ai/wechat-ipad](./extensions/wechat-ipad) | 微信 iPad 协议 | MIT |

### 🧠 AI Capabilities
| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-knowledge](./extensions/knowledge) | RAG 知识库引擎 (embedding + vector + hybrid retrieval) |

### 🔌 Message Queues & IoT
| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-mqtt](./extensions/mqtt) | MQTT 3.1.1/5.0 协议桥接 |
| [@partme.ai/openclaw-web-mqtt](./extensions/web-mqtt) | Web MQTT (浏览器端) |
| [@partme.ai/openclaw-stomp](./extensions/stomp) | STOMP 协议桥接 |
| [@partme.ai/openclaw-web-stomp](./extensions/web-stomp) | Web STOMP (浏览器端) |
| [@partme.ai/openclaw-rabbitmq](./extensions/rabbitmq) | RabbitMQ 消息队列 |
| [@partme.ai/openclaw-redis-stream](./extensions/redis-stream) | Redis Stream 消息队列 |
| [@partme.ai/openclaw-rocketmq](./extensions/rocketmq) | RocketMQ 消息队列 |
| [@partme.ai/openclaw-cluster](./extensions/cluster) | 集群通信 |

### 🏗️ Infrastructure
| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-nacos](./extensions/nacos) | Nacos 配置中心 & 服务注册 |
| [@partme.ai/openclaw-prometheus](./extensions/prometheus) | Prometheus 指标监控 |
| [@partme.ai/openclaw-tracing](./extensions/tracing) | OpenTelemetry 分布式追踪 |
| [@partme.ai/openclaw-mtls](./extensions/mtls) | Mutual TLS 认证 |
| [@partme.ai/openclaw-oauth2](./extensions/oauth2) | OAuth 2.0 / Sa-Token 集成 |

### 🌐 Platform Integrations
| Package | Description |
|---------|------------|
| [@partme.ai/openclaw-gotify](./extensions/gotify) | Gotify 推送通知 |
| [@partme.ai/openclaw-amap](./extensions/amap) | 高德地图 |
| [@partme.ai/openclaw-douyin](./extensions/douyin) | 抖音 |
| [@partme.ai/openclaw-meituan](./extensions/meituan) | 美团 |
| [@partme.ai/openclaw-rednode](./extensions/rednode) | RedNode 集成 |

---

## 🚀 Quick Start

```bash
# Install a single plugin
openclaw plugins install @partme.ai/wecom

# Or clone the entire monorepo for development
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install
pnpm build
```

## 📋 Plugin Development Spec

All plugins follow the [Plugin Specification](./spec/PLUGIN_SPEC.md). Key principles:

- **Independent**: Each plugin is self-contained, zero cross-plugin dependencies
- **Consistent**: Same config structure, error handling, logging, and lifecycle
- **Tested**: Co-located tests, minimum 80% coverage
- **Documented**: Every plugin has a README with setup guide

## 📖 Documentation

Full documentation at [doc/](./doc/):

| Document | Description |
|----------|------------|
| [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) | Install and configure plugins |
| [Architecture](./doc/OpenClaw-Plugins-Architecture.md) | Project architecture and design decisions |
| [Contributing](./doc/OpenClaw-Plugins-Contributing.md) | How to add a new plugin |
| [WeCom Guide](./doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md) | 企业微信全配置指南 |

## 📄 License

Plugins are released under their respective licenses (see table above).  
Core infrastructure and self-built plugins: **MIT License**.  
Forked official plugins retain their original licenses.
