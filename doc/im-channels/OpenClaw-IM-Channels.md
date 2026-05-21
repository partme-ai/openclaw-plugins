# IM 渠道插件 / IM Channel Plugins

即时通讯平台集成，将 OpenClaw AI Agent 接入企业微信、钉钉、飞书、QQ、微信等。

## 统一适配层

所有 IM 渠道通过 `@partme.ai/openclaw-bridge` 统一接入 PartMe.AI 生态（上下文注入 + 消息桥接）。
详见 [openclaw-bridge](../../extensions/bridge)。

## 官方上游插件

以下渠道由平台官方团队维护，需单独安装官方插件：

| 平台 | 渠道 ID | 官方仓库 | npm 包 | 文档 |
|------|---------|---------|--------|------|
| 钉钉 | `dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | `@dingtalk-real-ai/dingtalk-connector` | [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) |
| 飞书/Lark | `openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | `@larksuite/openclaw-lark` | [官方文档](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh) |
| QQ | `qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | `@tencent-connect/openclaw-qqbot` | — |

## Bundled 渠道（随 OpenClaw 内置）

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

以上 18 个渠道随 OpenClaw 发行版内置，无需单独安装，通过 openclaw-bridge 配置即可接入 PartMe.AI 生态。

## 自建插件

| 插件 | 说明 |
|------|------|
| [WeCom](./wecom/) | 企业微信 Bot + Agent 双模式 |
| WeChat | 微信公众号 / 客服消息 |
| WeCom KF | 企业微信客服（外部微信用户） |
| WeChat iPad | 微信 iPad 协议 |

## 共同特性

- 多账号矩阵隔离
- DM/Group 四级策略 (open/pairing/allowlist/disabled)
- 流式响应 + 超时降级
- 全媒体支持（图片/文件/视频/语音）
- 消息去重 + 状态上报
- openclaw-bridge 统一桥接（上下文注入 + UnifiedMessage → MQ）
