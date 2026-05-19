# WeCom (企业微信)

**OpenClaw channel plugin — Enterprise WeChat Work Bot + Agent dual-mode integration**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwecom-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-ISC-blue)

[English](./README.md) | [简体中文](./README_CN.md)

## Introduction

WeCom (`@partme.ai/wecom`) is the flagship channel plugin for [OpenClaw](https://github.com/openclaw/openclaw), providing enterprise WeChat Work integration with Bot + Agent dual-mode architecture.

### Highlights

- **Bot + Agent dual-mode**: WebSocket real-time chat + HTTP API for file/broadcast fallback
- **Multi-account matrix**: Unlimited account isolation, independent bot/agent per account
- **20 built-in Skills**: Contacts, docs, calendar, tasks, meetings, smartsheet
- **Full media support**: Image/video/voice/file send & receive with auto-downgrade
- **Streaming responses**: Typewriter effect with non-blocking send
- **Dynamic agents**: Per-user/per-group isolated agent instances
- **MCP tool**: `wecom_mcp` for direct WeCom MCP Server calls

## Quick start

### Install

```bash
openclaw plugins install @partme.ai/wecom
```

### Configure

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.botId "<YOUR_BOT_ID>"
openclaw config set channels.wecom.secret "<YOUR_SECRET>"
openclaw gateway restart
```

## Documentation

Full configuration guide: [WeCom Configuration](https://github.com/partme-ai/openclaw-plugins/tree/main/doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md)

## License

ISC License — based on [TencentCloud openclaw-wecom](https://github.com/TencentCloud-Lighthouse/openclaw-wecom).

## Links

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins)
- [企业微信配置指南](https://github.com/partme-ai/openclaw-plugins/tree/main/doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md)
