# 文档索引 / Documentation Index

## 项目文档 / Project

| English | 中文 |
|---------|------|
| [Architecture](./OpenClaw-Plugins-Architecture.md) | [架构设计](./OpenClaw-Plugins-Architecture_CN.md) |
| [Getting Started](./OpenClaw-Plugins-Getting-Started.md) | [快速开始](./OpenClaw-Plugins-Getting-Started_CN.md) |
| [Contributing](./OpenClaw-Plugins-Contributing.md) | [贡献指南](./OpenClaw-Plugins-Contributing_CN.md) |
| — | [插件目录结构与命名规范（强规范 / Normative）](./OpenClaw-Plugin-Structure-Standard.md) |

## 插件文档 / Plugin Docs

文档按插件子目录组织。各插件源码说明见 `extensions/<name>/README.md`。

### IM 渠道

| 插件 | 文档入口 | 说明 |
|------|----------|------|
| **wecom** | [渐进式配置 CN](./wecom/configuration-examples.zh-CN.md) · [EN](./wecom/configuration-examples.md) · [架构](./wecom/OpenClaw-WeCom-Architecture.md) · [配置](./wecom/OpenClaw-WeCom-Configuration.md) · [流式](./wecom/OpenClaw-WeCom-Streaming-Architecture.md) · [联调](./wecom/OpenClaw-WeCom-Testing.md) · [Feishu SDK 对照](./wecom/OpenClaw-WeCom-Feishu-SDK-Inventory.md) | 企业微信自建插件 |
| **lark** | [CLA](./lark/OpenClaw-Lark-CLA.md) | 贡献者协议；飞书/Lark 通道见官方 `@larksuite/openclaw-lark` + [openclaw-bridge](../extensions/bridge/README.zh-CN.md) |
| **dingtalk** | — | 官方 `@dingtalk-real-ai/dingtalk-connector` + [openclaw-bridge](../extensions/bridge/README.zh-CN.md) |

### AI 能力

| 插件 | 文档入口 |
|------|----------|
| **knowledge** | [指南](./knowledge/OpenClaw-Knowledge-RAG-Guide_CN.md) · [架构](./knowledge/OpenClaw-Knowledge-RAG-Architecture_CN.md) · [集成](./knowledge/OpenClaw-Knowledge-RAG-Integration_CN.md) · [策略](./knowledge/OpenClaw-Knowledge-RAG-Strategy_CN.md) · [开发](./knowledge/OpenClaw-Knowledge-RAG-Development_CN.md) |

### 消息队列

| 插件 | 文档入口 |
|------|----------|
| **redis-stream** | [Guide (EN)](./redis-stream/OpenClaw-Redis-Stream-Guide.md) · [指南 (CN)](./redis-stream/OpenClaw-Redis-Stream-Guide_CN.md) · [架构 (CN)](./redis-stream/OpenClaw-Redis-Stream-Architecture_CN.md) · [参考 (CN)](./redis-stream/OpenClaw-Redis-Stream-Reference_CN.md) |
| **rocketmq** | [Guide](./rocketmq/OpenClaw-RocketMQ-Guide.md) · [Architecture](./rocketmq/OpenClaw-RocketMQ-Architecture.md) · [API](./rocketmq/OpenClaw-RocketMQ-API.md) · [Technical](./rocketmq/OpenClaw-RocketMQ-Technical.md) · [Development](./rocketmq/OpenClaw-RocketMQ-Development.md) |

### 基础设施

| 插件 | 文档入口 |
|------|----------|
| **nacos** | [Guide (EN)](./nacos/OpenClaw-Nacos-Guide.md) · [指南 (CN)](./nacos/zh/OpenClaw-Nacos-Guide_CN.md) · [Architecture](./nacos/OpenClaw-Nacos-Architecture.md) · [Configuration](./nacos/OpenClaw-Nacos-Configuration.md) |
| **prometheus** | [Deployment](./prometheus/OpenClaw-Prometheus-Deployment.md) · [Architecture](./prometheus/OpenClaw-Prometheus-Architecture.md) · [Metrics](./prometheus/OpenClaw-Prometheus-Metrics.md) · [指南 (CN)](./prometheus/zh/OpenClaw-Prometheus-Guide_CN.md) · [Grafana](./prometheus/grafana/OpenClaw-Prometheus-Grafana-README.md) |
| **gotify** | [指南 (CN)](./gotify/OpenClaw-Gotify-Guide_CN.md) · [架构 (CN)](./gotify/OpenClaw-Gotify-Architecture_CN.md) · [场景手册](./gotify/guide/OpenClaw-Gotify-Scenario-CI-CD.md)（`gotify/guide/` 目录下共 10 篇） |

### 其他

| 插件 | 文档入口 |
|------|----------|
| **qqbot** | [Commands](./qqbot/OpenClaw-QQBot-Commands.md) · [Upgrade Guide](./qqbot/OpenClaw-QQBot-Upgrade-Guide.md) · [升级指南 (CN)](./qqbot/zh/OpenClaw-QQBot-Upgrade-Guide_CN.md) |

## 开发 / Development

- [Plugin Specification](../spec/PLUGIN_SPEC.md)
- [Plugin doc template](./_template.md)
- [Scaffold](../extensions/_template)
