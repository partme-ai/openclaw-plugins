# OpenClaw Plugins — 架构设计

## 概述

openclaw-plugins 是 partme.ai 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件（含基于第三方开源项目的二次开发），覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件作为独立 npm 包发布在 `@partme.ai` scope 下，可单独安装：

```bash
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/mqtt
npm install @partme.ai/nacos
```

> ⚠️ 部分插件基于第三方开源项目（TencentCloud、Tencent、LarkSuite）二次开发，保留原始许可证。详见各插件的 LICENSE 文件。

---

## 设计原则

### 独立完整

每个插件自包含，**零跨插件依赖**。用户只装需要的那个，不会拖入额外依赖。

### 统一标准

所有插件遵循同一套开发规范：
- 相同的目录结构
- 相同的配置格式（Zod + JSON Schema）
- 相同的错误处理模式（类型化 Error 类）
- 相同的生命周期（setStatus 上报）
- 相同的测试规范（co-located，Vitest，80%+）

### 生产就绪

每个插件都面向生产环境设计：
- 多账号支持（accounts 矩阵）
- DM/Group 四级策略（open/pairing/allowlist/disabled）
- 流式处理 + 超时降级
- 媒体文件大小检查 + 自动降级
- 结构化日志 + 状态上报

---

## 插件分类

### 📱 IM 渠道

| 插件 | 平台 | SDK | 模式 | 来源 |
|------|------|-----|------|------|
| wecom | 企业微信 | `@wecom/aibot-node-sdk` | WebSocket / Webhook / Agent | TencentCloud 二次开发 |
| dingtalk | 钉钉 | `dingtalk-stream` | Stream 长连接 | 自研 |
| lark | 飞书/Lark | `@larksuiteoapi/node-sdk` | WebSocket / Webhook | LarkSuite 二次开发 |
| qqbot | QQ 机器人 | 自封装 HTTP | WebSocket | QQ 官方二次开发 |
| wechat | 微信公众号 | 自封装 HTTP | 被动回复 / 主动发送 | Tencent 二次开发 |
| wecom-kf | 微信客服 | 自封装 HTTP | Webhook 回调 | 自研 |
| wechat-ipad | 微信 iPad | 自封装 | iPad 协议 | 自研 |

### 🔌 消息队列 & IoT

| 插件 | 协议 | 来源 |
|------|------|------|
| mqtt | MQTT 3.1.1/5.0 | 自研 |
| web-mqtt | MQTT over WebSocket | 自研 |
| stomp | STOMP | 自研 |
| web-stomp | STOMP over WebSocket | 自研 |
| rabbitmq | AMQP 0-9-1 | 自研 |
| redis-stream | Redis Stream | 自研 |
| rocketmq | RocketMQ | 自研 |
| cluster | 集群通信 | 自研 |
| ics | ICS 智能客服 | 自研 |

### 🏗️ 基础设施

| 插件 | 功能 | 来源 |
|------|------|------|
| nacos | 配置中心 + 服务注册 | 自研 |
| prometheus | 指标采集 + 导出 | 自研 |
| tracing | OpenTelemetry 分布式追踪 | 自研 |
| mtls | 双向 TLS 认证 | 自研 |
| oauth2 | OAuth 2.0 / Sa-Token | 自研 |

### 🧠 AI 能力

| 插件 | 功能 | 来源 |
|------|------|------|
| knowledge | RAG 知识库 | 自研 |
| memory | 多级记忆系统 | 计划中 |

---

## 目录结构

```
openclaw-plugins/
├── extensions/          # 所有插件
│   ├── _template/       # 新插件脚手架
│   └── wecom/ wechat/ mqtt/ nacos/ ...   # 30 个插件
├── doc/                 # 统一文档中心（中英双语）
├── spec/                # 开发规范
├── scripts/             # CI/CD 工具
└── test-utils/          # 共享测试工具
```

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js >= 22，ES Modules |
| 语言 | TypeScript 5.7+，strict mode |
| 构建 | tsup（ESM 输出） |
| 测试 | Vitest，co-located tests |
| 配置校验 | Zod + JSON Schema |
| 包管理 | pnpm workspace |
| CI/CD | GitHub Actions（矩阵构建） |

## 许可证

| 来源 | 插件 | 许可证 |
|------|------|--------|
| 自研 | 大部分插件 | MIT |
| TencentCloud fork | wecom | ISC |
| Tencent fork | wechat | SEE LICENSE |
| LarkSuite fork | lark | MIT |
| QQ fork | qqbot | MIT |
| 归档项目 | wecom-ics | Apache-2.0 |
