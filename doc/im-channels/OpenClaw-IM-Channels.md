# IM 渠道插件 / IM Channel Plugins

即时通讯平台集成，将 OpenClaw AI Agent 接入企业微信、钉钉、飞书、QQ、微信等。

## 插件列表

| 插件 | 平台 | 模式 | 文档 |
|------|------|------|------|
| [WeCom](./wecom/) | 企业微信 | WebSocket / Webhook / Agent | [配置指南](./wecom/OpenClaw-WeCom-Configuration.md) |
| [Lark](./lark/) | 飞书/Lark | WebSocket / Webhook | [CLA](./lark/OpenClaw-Lark-CLA.md) |
| DingTalk | 钉钉 | Stream 长连接 | [截图参考](./dingtalk/images/) |
| QQ Bot | QQ | WebSocket | 待补充 |
| WeChat | 微信 | 被动回复 / 主动发送 | 待补充 |
| WeCom KF | 微信客服 | Webhook 回调 | 待补充 |
| WeChat iPad | 微信 iPad | iPad 协议 | 待补充 |

## 共同特性

- 多账号矩阵隔离
- DM/Group 四级策略 (open/pairing/allowlist/disabled)
- 流式响应 + 超时降级
- 全媒体支持（图片/文件/视频/语音）
