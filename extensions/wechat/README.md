<div align="center">

# OpenClaw WeChat

**OpenClaw 微信个人号渠道插件：扫码登录、多账号在线、文本与媒体消息收发**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fweixin-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-Custom-lightgrey)

[简体中文](./README.md) | [English](./README.en.md)

</div>

`@partme.ai/weixin` 用于把个人微信账号接入 OpenClaw。插件通过扫码完成登录授权，登录凭据保存在本地，可同时维护多个微信账号，并把私聊消息转成 OpenClaw Agent 可处理的会话。

> 说明：本插件面向需要个人微信通道的中国用户。生产客服、企业合规和主动外呼场景优先评估企业微信官方能力，例如 `@partme.ai/wecom` 或 `@partme.ai/wecom-kf`。

## 兼容性

| 插件版本 | OpenClaw 版本 | npm dist-tag | 状态 |
|---------|---------------|--------------|------|
| 2.0.x | `>=2026.3.22` | `latest` | 活跃 |
| 1.0.x | `>=2026.1.0 <2026.3.22` | `legacy` | 维护中 |

插件启动时会检查宿主版本。如果运行的 OpenClaw 版本不满足要求，插件会拒绝加载。

## 核心能力

- **扫码登录**：通过 `openclaw channels login` 在终端展示二维码。
- **多账号在线**：每次扫码可新增一个账号条目。
- **会话隔离**：推荐使用 `session.dmScope=per-account-channel-peer`，避免多个微信号共享私聊上下文。
- **消息收发**：支持文本、图片、语音、视频、文件等消息结构，媒体经 CDN 与 AES-128-ECB 参数传输。
- **后端 API 对接**：提供 `getupdates`、`sendmessage`、`getuploadurl`、`getconfig`、`sendtyping` 等 HTTP JSON 协议说明，便于二次开发或替换后端。

## 安装与更新

推荐使用安装脚本：

```bash
npx -y @tencent-weixin/openclaw-weixin-cli install
```

手动安装：

```bash
openclaw plugins install "@tencent-weixin/openclaw-weixin"
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw gateway restart
```

更新：

```bash
openclaw plugins update @tencent-weixin/openclaw-weixin
```

## 快速开始

1. 检查 OpenClaw 版本：

```bash
openclaw --version
```

2. 安装并启用插件：

```bash
openclaw plugins install "@tencent-weixin/openclaw-weixin"
openclaw config set plugins.entries.openclaw-weixin.enabled true
```

3. 扫码登录：

```bash
openclaw channels login --channel openclaw-weixin
```

终端会显示二维码。用手机微信扫码并确认授权，成功后登录凭据会自动保存到本地。

4. 重启并检查：

```bash
openclaw gateway restart
openclaw channels status --probe
openclaw channels list
```

5. 给已登录微信号发送一条私聊消息，确认 Agent 正常回复。

## 多账号与会话隔离

继续执行登录命令即可添加更多微信账号：

```bash
openclaw channels login --channel openclaw-weixin
```

多个微信号同时在线时，建议把私聊上下文按「账号 + 渠道 + 对端」隔离：

```bash
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
```

## 后端 API 协议概览

本插件通过 HTTP JSON API 与后端网关通信。所有接口均为 `POST`，请求和响应均为 JSON。

通用请求头：

| Header | 说明 |
|--------|------|
| `Content-Type` | `application/json` |
| `AuthorizationType` | 固定值 `ilink_bot_token` |
| `Authorization` | `Bearer <TOKEN>` |
| `X-WECHAT-UIN` | 随机 uint32 的 base64 编码 |

接口列表：

| 接口 | 路径 | 用途 |
|------|------|------|
| `getUpdates` | `getupdates` | 长轮询获取新消息 |
| `sendMessage` | `sendmessage` | 发送文本、图片、视频或文件 |
| `getUploadUrl` | `getuploadurl` | 获取 CDN 上传预签名参数 |
| `getConfig` | `getconfig` | 获取账号配置，例如 typing ticket |
| `sendTyping` | `sendtyping` | 发送或取消输入状态 |

文本发送示例：

```json
{
  "msg": {
    "to_user_id": "<TARGET_USER_ID>",
    "context_token": "<CONVERSATION_CONTEXT_TOKEN>",
    "item_list": [
      {
        "type": 1,
        "text_item": {
          "text": "你好，我是 OpenClaw Agent。"
        }
      }
    ]
  }
}
```

媒体上传流程：

1. 计算原文件明文大小、MD5 和 AES-128-ECB 加密后的密文大小。
2. 图片/视频需要额外计算缩略图参数。
3. 调用 `getuploadurl` 获取 `upload_param` 和可选的 `thumb_upload_param`。
4. 加密后 PUT 上传到 CDN。
5. 用返回的 `encrypt_query_param` 和 `aes_key` 构造媒体消息并调用 `sendmessage`。

完整类型定义见 `src/api/types.ts`，API 调用实现见 `src/api/api.ts`。

## 常用验证命令

```bash
openclaw channels list
openclaw channels status --probe
openclaw plugins doctor
openclaw gateway restart
```

本地测试：

```bash
cd extensions/wechat
pnpm build
pnpm typecheck
pnpm test
```

## 常见问题

### 报错 `requires OpenClaw >=2026.3.22`

当前 OpenClaw 版本过旧。先检查版本：

```bash
openclaw --version
```

如果暂时不能升级宿主，可安装 legacy 版本：

```bash
openclaw plugins install @tencent-weixin/openclaw-weixin@legacy
```

### 通道显示 OK 但没有连接

确认插件已启用并重启 Gateway：

```bash
openclaw config set plugins.entries.openclaw-weixin.enabled true
openclaw gateway restart
openclaw channels status --probe
```

### 多个微信号回复串上下文

配置会话隔离：

```bash
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
```

### 扫码后登录失效

重新扫码登录：

```bash
openclaw channels login --channel openclaw-weixin
openclaw gateway restart
```

## 卸载

```bash
openclaw plugins uninstall @tencent-weixin/openclaw-weixin
```

## 许可证

See `LICENSE`.
