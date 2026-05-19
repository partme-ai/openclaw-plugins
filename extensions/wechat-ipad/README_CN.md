# openclaw_wechat_ipad

微信 iPad 协议桥接插件 —— 通过外部 iPad 协议服务将个人微信号接入 OpenClaw Agent。

## 架构概览

```
微信服务器
    ↕ MMTLS / Protobuf（iPad 协议）
iPad 协议服务（独立进程，处理底层通信）
    ↕ WebSocket 事件推送 + HTTP API 发送
openclaw_wechat_ipad（本插件，桥接层）
    ↕ OpenClaw Runtime 4 步消息管道
OpenClaw Gateway → Agent
```

### 设计原则

1. **职责单一**：本插件只做「桥接」，不涉及 MMTLS / Protobuf / 07/08 算法等底层协议实现
2. **服务解耦**：通过 WebSocket + HTTP API 与 iPad 协议服务通信，协议服务可独立部署与升级
3. **遵循 OpenClaw 规范**：与 `openclaw-web-stomp`、`openclaw-mqtt` 等协议适配器保持一致的插件结构

## 核心能力

| 能力 | 说明 |
|------|------|
| 消息接收 | 文本、图片、语音、视频、链接、名片、位置、小程序、表情 |
| 消息发送 | 文本消息（更多类型可扩展） |
| 群消息 | 可选开启，支持群 wxid 白名单 |
| 会话管理 | wxid ↔ sessionKey 双向映射，支持私聊和群聊 |
| 自动重连 | 指数退避策略（base × 2^n，上限 60s） |
| 状态监控 | HTTP 端点查询桥接状态、登录信息、会话列表 |
| 消息过滤 | 忽略自身消息、群消息白名单 |

## 消息流程

### 入站（微信用户 → Agent）

```
1. iPad 协议服务推送 message 事件
2. 插件检查过滤规则（自己/群消息/白名单）
3. message-converter 将微信消息转为 Agent 文本
4. session-mapper 获取/创建会话映射
5. OpenClaw Runtime 4 步管道：
   a. resolveAgentRoute → 路由到目标 Agent
   b. finalizeInboundContext → 构造入站上下文
   c. createReplyDispatcherWithTyping → 创建回复分发器
   d. dispatchReplyFromConfig → 触发 Agent 处理
```

### 出站（Agent → 微信用户）

```
1. Agent 生成回复文本
2. OpenClaw 调用 channel.outbound.sendText(sessionKey, text)
3. 从 sessionKey 解析目标 wxid
4. message-converter 构造发送请求
5. 通过 iPad 协议服务 HTTP API 发送到微信
```

## 文件结构

```
openclaw_wechat_ipad/
├── openclaw.plugin.json       # 插件清单（channel、configSchema）
├── package.json               # npm 配置
├── tsconfig.json              # TypeScript 配置
├── tsup.config.ts             # 构建配置
├── vitest.config.ts           # 测试配置
├── src/
│   ├── index.ts               # 插件入口（register、事件处理、HTTP 端点）
│   ├── types.ts               # 全部类型定义
│   ├── channel.ts             # wechat-ipad Channel 定义
│   ├── ipad-bridge.ts         # iPad 协议服务桥接层（WebSocket + HTTP）
│   ├── session-mapper.ts      # wxid ↔ sessionKey 会话映射
│   ├── message-converter.ts   # 消息格式转换（微信 ↔ Agent）
│   ├── session-mapper.test.ts # 会话映射单元测试
│   └── message-converter.test.ts # 消息转换单元测试
└── dist/                      # 构建输出
```

## 配置参考

```yaml
channels:
  wechat-ipad:
    # iPad 协议服务 WebSocket 地址（接收事件推送）
    serviceUrl: "ws://127.0.0.1:5555"
    # iPad 协议服务 HTTP API 地址（发送消息、查询状态）
    apiUrl: "http://127.0.0.1:5556"
    # 重连策略
    reconnect:
      enabled: true
      intervalMs: 5000        # 基础重连间隔
      maxRetries: 30          # 最大重试次数（0 = 无限）
    # 认证
    auth:
      token: "your-token"     # iPad 协议服务认证 token
    # 消息处理规则
    message:
      handleGroup: false      # 是否处理群消息
      groupWhitelist: []      # 群 wxid 白名单（空 = 全部）
      ignoreself: true        # 忽略自身发送的消息
```

## HTTP 状态端点

### `GET /wechat-ipad/status`

返回桥接状态、登录信息、会话统计：

```json
{
  "ok": true,
  "data": {
    "bridge": {
      "state": "logged_in",
      "reconnectCount": 0,
      "lastHeartbeat": "2026-03-02T12:00:00.000Z",
      "loginInfo": {
        "wxid": "wxid_xxx",
        "nickname": "测试号",
        "status": "logged_in"
      }
    },
    "sessions": {
      "total": 5,
      "direct": 3,
      "group": 2
    },
    "service": { ... }
  }
}
```

### `GET /wechat-ipad/sessions`

返回活跃会话列表：

```json
{
  "ok": true,
  "data": [
    {
      "wxid": "wxid_user1",
      "agentId": "agent-001",
      "sessionKey": "wechat-ipad:wxid_user1@agent-001",
      "isGroup": false,
      "lastActiveAt": "2026-03-02T12:00:00.000Z"
    }
  ]
}
```

## iPad 协议服务接口规范

### WebSocket 事件推送（入站）

iPad 协议服务需要通过 WebSocket 推送 JSON 格式事件：

```typescript
interface IpadEvent<T> {
  type: string;       // 事件类型
  data: T;            // 事件负载
  timestamp: number;  // 时间戳（毫秒）
}
```

| 事件类型 | 负载说明 |
|----------|----------|
| `message` | 微信消息（msgId, fromWxid, toWxid, msgType, content, ...） |
| `login_status` | 登录状态变更（status, wxid, nickname, qrCodeBase64, ...） |
| `friend_request` | 好友请求（fromWxid, nickname, verifyContent, ticket） |
| `contact_update` | 联系人变更 |
| `group_member_update` | 群成员变更 |
| `heartbeat` | 心跳 |
| `ready` | 连接就绪 |
| `error` | 错误 |

### HTTP API（出站）

| 端点 | 方法 | 请求体 | 说明 |
|------|------|--------|------|
| `/api/send` | POST | `{ toWxid, msgType, content, ... }` | 发送消息 |
| `/api/status` | GET | - | 获取服务状态 |

## 合规声明

> **重要**：iPad 协议为微信非官方逆向协议，存在以下风险：
> - 账号封禁/功能限制
> - 法律与合规风险
> - 协议随微信版本变更需持续维护
>
> **建议**：生产环境优先使用企业微信官方 API（`openclaw_wecom_kf`），iPad 协议仅用于技术研究或内部测试。

## 许可证

MIT
