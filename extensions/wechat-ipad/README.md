# WeChat iPad

WeChat iPad Protocol Bridge for OpenClaw — 通过 iPad 协议服务实现个人微信号与 OpenClaw Agent 的双向消息对接。

## 架构

```
微信服务器
    ↕ MMTLS / Protobuf（iPad 协议）
iPad 协议服务（独立进程）
    ↕ WebSocket 事件推送 + HTTP API 发送
openclaw_wechat_ipad（本插件）
    ↕ OpenClaw Runtime 4 步消息管道
OpenClaw Gateway → Agent
```

本插件**不直接实现** iPad 协议的底层通信（MMTLS、Protobuf、07/08 算法等），而是作为**桥接层**，对接一个独立运行的 iPad 协议服务：

- **入站**：iPad 协议服务通过 WebSocket 推送微信消息 → 本插件转换为 Agent 可处理的文本 → OpenClaw Runtime 调度 Agent
- **出站**：Agent 回复 → 本插件通过 HTTP API 调用 iPad 协议服务 → 发送到微信

## 功能

- **消息类型支持**：文本、图片（描述）、语音、视频、链接、名片、位置、小程序、表情
- **群消息**：可选开启，支持白名单过滤
- **会话管理**：wxid ↔ sessionKey 双向映射
- **自动重连**：指数退避重连策略
- **状态监控**：HTTP 端点查询桥接状态、登录信息、会话列表

## 安装

```bash
npm install @partme.ai/openclaw-wechat_ipad
```

## 配置

在 OpenClaw 配置中添加 `wechat-ipad` channel：

```yaml
channels:
  wechat-ipad:
    serviceUrl: "ws://127.0.0.1:5555"    # iPad 协议服务 WebSocket
    apiUrl: "http://127.0.0.1:5556"       # iPad 协议服务 HTTP API
    reconnect:
      enabled: true
      intervalMs: 5000
      maxRetries: 30
    auth:
      token: "your-service-token"          # 可选
    message:
      handleGroup: false                   # 是否处理群消息
      groupWhitelist: []                   # 群 wxid 白名单
      ignoreself: true                     # 忽略自己发送的消息
```

## HTTP 端点

| 端点 | 说明 |
|------|------|
| `GET /wechat-ipad/status` | 桥接状态、登录信息、会话统计 |
| `GET /wechat-ipad/sessions` | 活跃会话列表 |

## iPad 协议服务接口规范

本插件要求 iPad 协议服务提供以下接口：

### WebSocket 事件推送

连接 `serviceUrl`，接收 JSON 格式事件：

```json
{
  "type": "message",
  "data": {
    "msgId": "...",
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

支持的事件类型：`message`、`login_status`、`contact_update`、`group_member_update`、`friend_request`、`qr_code`、`heartbeat`、`ready`、`error`

### HTTP API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/send` | POST | 发送消息 |
| `/api/status` | GET | 获取服务状态 |

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（监听变更）
npm run build        # 构建
npm run typecheck    # 类型检查
npm run test         # 运行测试
npm run test:watch   # 测试监听模式
```

## 合规声明

iPad 协议为微信非官方协议，存在封号与合规风险。建议：

- 生产环境优先使用**企业微信官方 API**（参见 `openclaw_wecom_kf`）
- iPad 协议仅用于技术研究或内部测试
- 使用前需进行合规与风控评估

## License

MIT
