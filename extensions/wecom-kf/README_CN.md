<div align="center">

# OpenClaw WeCom KF

**企业微信客服渠道 -- 企微客服 · 智能转人工 · 事件消息 · 多账号支持**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--wecom--kf-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![WeCom](https://img.shields.io/badge/WeCom-%E4%BC%81%E5%BE%AE%E5%AE%A2%E6%9C%8D-blue)

</div>

[English](./README.md) | [简体中文](./README_CN.md)

---

本插件将 OpenClaw 与企业微信的微信客服 API 集成，使 AI Agent 能够自动处理客户咨询，同时在需要时无缝转接人工客服。

**范围说明**：本插件**仅实现**微信客服的接收/发送消息、事件消息、回调、接待人员列表、客服账号列表、客服链接、分配会话等能力，**不含**管理功能（如客服账号/接待人员增删改、知识库、统计、客户详情等接口）。

## 特性

- **自动账号发现** -- 启动时自动发现并注册所有客服账号
- **多账号支持** -- 每个 `open_kfid` 可映射到不同的 OpenClaw Agent
- **智能转人工** -- 内置技能支持上下文感知的人工转接
- **可配置事件消息** -- 欢迎语、结束语、满意度评价
- **边聊边处理** -- 回调先返回 200，同批消息有限并发处理
- **会话隔离** -- 支持 `per-account-channel-peer` 级别会话隔离
- **Agent 模板** -- 提供售前、支持、售后三种即用型 Agent 模板

## 前置要求

- OpenClaw `>= 2026.4.0`
- Node.js `20+`
- 企业微信自建应用（已加入"微信客服-可调用接口的应用"）

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-wecom-kf
```

### 配置

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "企业ID",
      "corpSecret": "应用密钥",
      "token": "回调Token",
      "encodingAESKey": "AES密钥",
      "eventMessages": {
        "welcome": {
          "enabled": true,
          "msgtype": "text",
          "content": { "content": "您好！我是智能客服，有什么可以帮您？" }
        },
        "ending": {
          "enabled": true,
          "msgtype": "text",
          "content": { "content": "感谢您的咨询，再见！" }
        },
        "satisfaction": {
          "enabled": true,
          "head_content": "请对本次服务进行评价",
          "options": [
            { "id": "1", "content": "满意" },
            { "id": "2", "content": "一般" },
            { "id": "3", "content": "不满意" }
          ]
        }
      },
      "accounts": {
        "kf_xxx": {
          "agentId": "presale-agent",
          "eventMessages": {}
        }
      }
    }
  }
}
```

## 配置说明

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `corpId` | string | -- | 企业微信 Corp ID |
| `corpSecret` | string | -- | 客服应用密钥 |
| `token` | string | -- | 回调验证 Token |
| `encodingAESKey` | string | -- | 回调加解密 AES Key |
| `session.dmScope` | string | `per-account-channel-peer` | 会话隔离级别 |
| `session.resetByChannel.mode` | string | `idle` | 会话重置模式 |
| `session.resetByChannel.idleMinutes` | number | 2880 | 空闲重置时间（48 小时） |
| `humanTransfer.waitTimeout` | number | 300 | 无人工客服时等待超时（秒） |

## 回调配置

企微后台「接收消息服务器配置」中，回调 URL 填写：

**`https://你的域名/wecom/kefu`**

服务器需在 **5 秒内** 返回 HTTP 200，否则企微会重试。

### 开启客服委托（三步）

**第一步：将自建应用加入"可调用接口的应用"**

登录 [企业微信管理后台](https://work.weixin.qq.com/)，进入 **客户联系 → 微信客服 → API 与回调**，将自建应用添加进去。

**第二步：配置回调 URL 与密钥**

在 **应用管理 → 自建应用 → 你的应用 → 接收消息服务器配置** 中填写：
- **URL**：`https://你的公网域名/wecom/kefu`
- **Token**：与配置中 `channels.wecom-kf.token` 一致
- **EncodingAESKey**：与配置中 `channels.wecom-kf.encodingAESKey` 一致

**第三步：为应用授权至少一个客服账号**

为自建应用授权至少一个客服账号，完成后企微会向回调 URL 推送 `kf_msg_or_event` 事件。

## 与 wecom 插件的关系

| 维度 | wecom（客户联系） | wecom-kf（微信客服） |
|------|-------------------|----------------------|
| 典型用途 | 内部/客户与机器人聊天 | 外部用户从"微信客服"进线 |
| 回调路径 | `/plugins/wecom/bot/{accountId}` | `/wecom/kefu` |
| 后台配置 | 自建应用"接收消息" | 加入"微信客服-可调用接口的应用" |

一个自建应用只能填一个接收消息 URL，因此如需同时使用，需要**两个自建应用**分别配置。

## API 约束

| 约束 | 值 | 说明 |
|------|-----|------|
| 回复窗口 | 48 小时 | 必须在客户最后一条消息后 48 小时内回复 |
| 消息限制 | 5 条 | 每条客户消息最多回复 5 条 |
| sync_msg 有效期 | 3 天 | 超过 3 天的消息无法拉取 |
| Token 有效期 | 10 分钟 | Access Token 10 分钟过期 |
| welcome_code 有效期 | 20 秒 | 必须在 20 秒内发送欢迎语 |

## 会话状态

| 状态值 | 说明 |
|--------|------|
| 0 | 未处理（新会话进入，自动变为 1） |
| 1 | 由智能客服接待（AI Agent） |
| 2 | 待接入池（等待人工接待） |
| 3 | 由人工客服接待 |
| 4 | 已结束 |

## 消息流程

1. 企微向 `/wecom/kefu` 发送 POST 回调
2. 插件使用 AES-256-CBC 解密回调
3. 事件路由：`msg` 事件 → Agent；`enter_session` → 欢迎语；`session_status_change`（结束）→ 结束语
4. Agent 处理消息，生成回复
5. 插件调用 `kf/send_msg` 发送回复

## 企微 API 覆盖

| API | 端点 | 用途 |
|-----|------|------|
| 回调接收 | `/wecom/kefu` | 接收消息/事件通知 |
| 同步消息 | `kf/sync_msg` | 拉取消息（3 天内） |
| 发送消息 | `kf/send_msg` | AI 回复客户 |
| 事件消息 | `kf/send_msg_on_event` | 欢迎语/结束语 |
| 会话状态 | `kf/service_state/get` | 查询当前会话状态 |
| 转接 | `kf/service_state/trans` | 转接人工客服 |
| 账号列表 | `kf/account/list` | 发现所有客服账号 |
| 客服列表 | `kf/servicer/list` | 获取可用人工客服 |

## Agent 模板

| 模板 | 路径 | 适用场景 |
|------|------|----------|
| 售前 | `templates/presale-agent/` | 售前与销售 |
| 支持 | `templates/support-agent/` | 技术支持 |
| 售后 | `templates/aftersale-agent/` | 售后服务 |

包含：AGENTS.md、SOUL.md、IDENTITY.md、USER.md、TOOLS.md、HEARTBEAT.md

## 项目结构

```
wecom_kf/
├── src/
│   ├── index.ts                  # 入口
│   ├── types.ts                  # 类型定义
│   ├── channel.ts                # 渠道定义
│   ├── callback.ts               # HTTP 回调处理
│   ├── message-handler.ts        # 客户消息 → Agent 回复管线
│   ├── system-event-handler.ts   # 欢迎语/结束语/满意度
│   ├── wecom-api.ts              # 企微 API
│   ├── account-manager.ts        # 账号自动发现与缓存
│   ├── crypto.ts                 # AES-256-CBC 加解密
│   ├── config.ts                 # 配置读取
│   └── cursor-store.ts           # next_cursor 持久化
├── skills/
│   └── transfer-to-human/        # 转人工 skill
├── hooks/
│   └── session-memory/           # 会话记忆钩子
├── templates/
│   ├── presale-agent/
│   ├── support-agent/
│   └── aftersale-agent/
├── package.json
├── openclaw.plugin.json
└── README.md / README_CN.md
```

## 生产环境清单

- **回调 URL**：使用 **HTTPS** 与稳定公网域名；**5 秒内**返回 200
- **企业可信 IP**：放行 [企业微信回调 IP 段](https://developer.work.weixin.qq.com/document/path/92521)
- **配置**：确保 `corpId`、`corpSecret`、`token`、`encodingAESKey` 与企微应用一致

## 测试

```bash
pnpm test           # 运行单元测试
pnpm test:watch     # 监听模式
pnpm test:coverage  # 覆盖率报告
```

## 相关链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [企业微信微信客服概述](https://developer.work.weixin.qq.com/document/path/94638)
- [微信客服回调通知](https://developer.work.weixin.qq.com/document/path/97712)

## 许可证

本项目采用 [MIT License](LICENSE) 协议。
