# Douyin

OpenClaw 抖音开放平台渠道与运营工具插件，公域 Agent-First 智能运营。符合《公域平台 Agent-First 智能运营设计文档》与《抖音开放平台对接规格》。

**优先对接**：[抖音生活服务商家应用](https://developer.open-douyin.com/docs/resource/zh-CN/local-life/connect/life-open-platform)，适合自建智能体、核销/发券/对账等场景；接口与 SDK 见 [生活服务 OpenAPI SDK 总览](https://developer.open-douyin.com/docs/resource/zh-CN/local-life/develop/sdk-overview)。

## 能力

- **官方插件入口**：`defineChannelPluginEntry`（`openclaw/plugin-sdk/core`），`setRuntime` 注入 Gateway 运行时
- **渠道** `douyin`：`createChatChannelPlugin`，混合账号配置 `channels.douyin`（含 `accounts.<id>`）
- **Gateway Webhook**：`gateway.startAccount` 内 `registerPluginHttpRoute`（`auth: "plugin"`，`pluginId: "douyin"`），默认路径见配置 `webhook_path`（默认 `/channels/douyin/webhook`）
- **入站**：验签与 `verify_webhook` 挑战后调用 `dispatchInboundDirectDmWithRuntime`（`openclaw/plugin-sdk/channel-inbound`）
- **出站**：当前为占位（抖音私信需走开放平台/OpenAPI；见代码注释）
- **工具**（`registerFull`）：douyin_query_orders、douyin_reply_review、douyin_query_shop_metrics

开发时直接使用 peer `openclaw` 提供的 `openclaw/plugin-sdk/*` 类型；不再维护本地 SDK 类型占位文件。

## 安装与配置

安装后于 `openclaw.json` 的 `channels.douyin` 中配置凭证与回调 URL。在抖音开放平台将回调地址设为 `https://<域名>/channels/douyin/webhook`。

Requires `@partme.ai/openclaw-message-sdk >= 2026.5.22`.

## 构建

```bash
pnpm install
pnpm build
```
