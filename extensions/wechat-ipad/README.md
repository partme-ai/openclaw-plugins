<div align="center">

# OpenClaw WeChat iPad

**OpenClaw 微信 iPad 协议桥接插件：通过外部 iPad 协议服务接入个人微信号**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fwechat--ipad-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/wechat-ipad` 是微信 iPad 协议服务与 OpenClaw Agent 之间的桥接层。插件本身不实现 MMTLS、Protobuf、07/08 算法等底层协议，而是连接一个独立运行的 iPad 协议服务：入站通过 WebSocket 接收事件，出站通过 HTTP API 发送消息。

> 合规提醒：iPad 协议为微信非官方协议，存在账号限制、封禁和合规风险。生产客服场景优先使用企业微信官方 API，例如 `@partme.ai/wecom` 或 `@partme.ai/wecom-kf`。

## 架构

```text
微信服务器
    ↕ MMTLS / Protobuf（由外部 iPad 协议服务处理）
iPad 协议服务（独立进程）
    ↕ WebSocket 事件推送 + HTTP API 发送
openclaw_wechat_ipad（本插件）
    ↕ OpenClaw Runtime 消息管道
OpenClaw Gateway → Agent
```

## 核心能力

- **桥接模式**：插件只负责协议服务适配、消息转换、会话映射和 OpenClaw Runtime 对接。
- **入站消息**：文本、图片、语音、视频、链接、名片、位置、小程序、表情等。
- **出站消息**：通过 iPad 协议服务 HTTP API 发送文本消息，更多类型可按服务能力扩展。
- **群消息控制**：可选开启群消息，并通过 `groupWhitelist` 做白名单。
- **会话管理**：`wxid` 与 `sessionKey` 双向映射，支持私聊和群聊。
- **自动重连**：WebSocket 断开后按指数退避策略重连。
- **状态端点**：提供桥接状态、登录信息和会话列表查询。

## 安装与更新

```bash
openclaw plugins install @partme.ai/wechat-ipad
openclaw plugins update @partme.ai/wechat-ipad
```

本地开发也可在插件目录安装依赖后构建：

```bash
cd extensions/wechat-ipad
pnpm install
pnpm build
```

## 快速开始

1. 启动外部 iPad 协议服务，并确认它暴露：
   - WebSocket 事件地址：`ws://127.0.0.1:5555`
   - HTTP API 地址：`http://127.0.0.1:5556`

2. 写入最小配置：

```bash
openclaw config set channels.wechat-ipad.serviceUrl "ws://127.0.0.1:5555"
openclaw config set channels.wechat-ipad.apiUrl "http://127.0.0.1:5556"
openclaw config set channels.wechat-ipad.reconnect.enabled true
openclaw gateway restart
openclaw channels status --probe
```

最小 JSON：

```json
{
  "channels": {
    "wechat-ipad": {
      "serviceUrl": "ws://127.0.0.1:5555",
      "apiUrl": "http://127.0.0.1:5556",
      "reconnect": {
        "enabled": true,
        "intervalMs": 5000,
        "maxRetries": 30
      },
      "message": {
        "handleGroup": false,
        "groupWhitelist": [],
        "ignoreself": true
      }
    }
  }
}
```

3. 在协议服务完成微信登录后，向登录微信号发送测试消息。

4. 检查状态：

```bash
openclaw channels status --probe
openclaw plugins doctor
```

## 生产配置示例

```json
{
  "channels": {
    "wechat-ipad": {
      "serviceUrl": "ws://wechat-ipad-bridge.internal:5555",
      "apiUrl": "http://wechat-ipad-bridge.internal:5556",
      "auth": {
        "token": "<BRIDGE_SERVICE_TOKEN>"
      },
      "reconnect": {
        "enabled": true,
        "intervalMs": 5000,
        "maxRetries": 0
      },
      "message": {
        "handleGroup": true,
        "groupWhitelist": ["<GROUP_WXID_1>", "<GROUP_WXID_2>"],
        "ignoreself": true
      }
    }
  }
}
```

`maxRetries: 0` 表示持续重连。群消息量可能较大，生产环境建议只开放白名单群。

## iPad 协议服务接口

### WebSocket 事件

插件连接 `serviceUrl` 并接收 JSON 事件：

```json
{
  "type": "message",
  "data": {
    "msgId": "<MESSAGE_ID>",
    "fromWxid": "wxid_xxx",
    "toWxid": "wxid_yyy",
    "msgType": 1,
    "content": "你好",
    "createTime": 1709456789,
    "isGroup": false,
    "isSelf": false
  },
  "timestamp": 1709456789000
}
```

常见事件：`message`、`login_status`、`contact_update`、`group_member_update`、`friend_request`、`qr_code`、`heartbeat`、`ready`、`error`。

### HTTP API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/send` | `POST` | 发送消息 |
| `/api/status` | `GET` | 查询协议服务状态 |

发送示例：

```json
{
  "toWxid": "wxid_target",
  "msgType": 1,
  "content": "你好，我是 OpenClaw Agent。"
}
```

## OpenClaw 状态端点

| 端点 | 说明 |
|------|------|
| `GET /wechat-ipad/status` | 桥接状态、登录信息、会话统计 |
| `GET /wechat-ipad/sessions` | 活跃会话列表 |

## 开发与测试

```bash
cd extensions/wechat-ipad
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm test:coverage
```

本地联调建议：

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw plugins doctor
```

## 常见问题

| 现象 | 常见原因 | 处理方式 |
|------|----------|----------|
| 无法连接协议服务 | `serviceUrl` 错误、服务未启动、网络不可达 | 先用协议服务自带健康检查确认 WS 可连接 |
| 能接收但无法发送 | `apiUrl` 错误或 HTTP API 鉴权失败 | 检查 `apiUrl`、`auth.token` 和协议服务日志 |
| 群消息没有触发 | `handleGroup=false` 或群不在白名单 | 开启 `handleGroup` 并配置 `groupWhitelist` |
| Agent 回复给错会话 | 会话映射异常或协议服务 wxid 不稳定 | 检查 `/wechat-ipad/sessions` 输出 |
| 频繁重连 | 协议服务心跳异常或网络抖动 | 检查 `heartbeat`、`reconnect` 参数和服务日志 |

## 许可证

MIT
