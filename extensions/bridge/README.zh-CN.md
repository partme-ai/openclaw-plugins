# OpenClaw Bridge

本文件保留为旧链接兼容入口，当前中文使用说明请阅读 [README.md](./README.md)。

当前实现已对齐 OpenClaw 2026.7.1：

- 插件清单 ID 为 `bridge`。
- 使用 `before_prompt_build`、`message_received`、`reply_payload_sending` 官方 Hook。
- MQ 镜像通过公共 channel outbound adapter 投递，不再调用不存在的 `api.publishInbound`。
- 飞书、QQ 的 stock Channel ID 分别为 `feishu`、`qqbot`。
- Bridge 提供有界内存重试；需要持久 Outbox、DLQ 与回放时使用 `@partme.ai/openclaw-router`。
