# OpenClaw 企业微信微信客服插件中文说明

`@partme.ai/wecom-kf` 将企业微信「微信客服」接入 OpenClaw 2026.7.1，让 Agent 处理来自公众号、小程序、视频号等入口的客户咨询，并在需要时转接人工客服。

本插件只实现微信客服 KF API，不包含普通 WeCom Bot/Agent、知识库管理或客服运营后台。完整配置和 Control Tools 说明见 [README.md](./README.md)。

## 核心消息链路

字符图用于终端、源码评审和 Markdown 原文快速看清“通知与真实消息拉取分离”的关键语义；后面的 Mermaid 时序、流程与路由图继续完整保留。

多账号回调遵循“路径绑定账号，事件只校验身份”。这条边界防止一个账号的回调凭据越权触发另一个账号：

```text
/wecom-kf/sales ──▶ accounts.sales ──▶ 用 sales Token/AESKey 验签解密
                                              │
                                              ▼
                                  OpenKfId == sales.openKfId？
                                      ┌───────┴───────┐
                                    否│               │是
                                      ▼               ▼
                               400，拒绝且不入队   快速 200 + sales 队列

路径绑定的账号是最终安全主体；解密后的 OpenKfId 不能重新选择 corpSecret。
```

```mermaid
flowchart LR
    P["精确回调路径"] --> A["绑定账号凭据"]
    A --> D["验签与 AES 解密"]
    D --> C{"OpenKfId 一致?"}
    C -->|否| R["400 拒绝"]
    C -->|是| Q["绑定账号串行队列"]
    Q --> S["sync_msg"]
```

```text
微信客户
   │ 咨询
   ▼
企业微信客服 ── 加密通知 ──▶ Callback（验签/解密/快速 ACK）
   ▲                              │
   │                              ▼
   │                    账号串行 sync_msg + 持久 cursor
   │                              │
   │                              ▼
   │                    msgid claim → Agent / 系统事件
   │                              │
   └── send_msg / transfer ───────┘

后台前置条件或处理失败：抛错 → 有界重试 → 不提交当前页 cursor
```

```mermaid
sequenceDiagram
    autonumber
    participant W as 微信客户
    participant Q as 企业微信微信客服
    participant C as wecom-kf
    participant A as OpenClaw Agent
    participant H as 人工客服

    W->>Q: 发送咨询
    Q->>C: kf_msg_or_event 加密回调
    C->>C: 验签、解密、去重
    C->>Q: kf/sync_msg(cursor, token)
    Q-->>C: 消息或事件列表
    C->>A: 按 open_kfid 路由会话
    alt Agent 可以处理
        A-->>C: 回复内容
        C->>Q: kf/send_msg
        Q-->>W: 投递回复
    else 需要人工
        A-->>C: transfer_session 控制动作
        C->>Q: 分配接待人员
        Q-->>H: 转入人工会话
    end
```

企业微信回调只是“有新消息”的通知，真实消息通过 `sync_msg` 拉取。游标必须在成功处理后持久推进，否则可能丢消息或重复消费。

```mermaid
flowchart LR
    A["加密回调<br/>运行中快速 200"] --> B["账号串行 sync_msg"]
    A -. 停机中 .-> S["返回 503<br/>要求企微重试"]
    B --> C{"响应和消息结构<br/>是否合法?"}
    C -->|否| R["有界指数退避重试"] --> B
    C -->|是| D["claim msgid"]
    D --> E{"Agent / 事件 / 出站<br/>是否成功?"}
    E -->|否| F["release claim<br/>不推进 cursor"] --> R
    E -->|是| G["commit msgid<br/>原子保存 cursor"]
    G --> H["重启回放时跳过重复消息"]
```

状态目录会主动收紧为 `0700`，游标和 JSON 状态文件为 `0600`。即使目录由旧版本创建，下一次写入也会修复过宽权限。

## 路由与会话模型

```mermaid
flowchart TD
    E1["公众号入口"] --> K1["open_kfid: 售前"] --> A1["presale-agent"]
    E2["小程序入口"] --> K2["open_kfid: 技术支持"] --> A2["support-agent"]
    E3["视频号入口"] --> K3["open_kfid: 售后"] --> A3["after-sales-agent"]
    K1 --> S["客户 + 客服账号<br/>独立会话"]
    K2 --> S
    K3 --> S
```

推荐使用 `session.dmScope=per-account-channel-peer`，并按 `open_kfid` 绑定不同 Agent。48 小时服务窗口、排队、结束会话和人工接待状态由企业微信微信客服语义约束。

## 最小配置

```bash
openclaw plugins install @partme.ai/wecom-kf
openclaw config set channels.wecom-kf.corpId "<YOUR_CORP_ID>"
openclaw config set channels.wecom-kf.corpSecret "<YOUR_CORP_SECRET>"
openclaw config set channels.wecom-kf.token "<YOUR_CALLBACK_TOKEN>"
openclaw config set channels.wecom-kf.encodingAESKey "<YOUR_43_CHAR_ENCODING_AES_KEY>"
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
openclaw channels status --probe
```

回调地址为 `https://<GATEWAY_HOST>/wecom/kefu`。正常运行时快速返回 200，耗时处理在确认后按账号异步执行；账号映射、`open_kfid`、Runtime 或 `corpSecret` 尚未就绪时会进入有界重试，不会把未处理通知误判为成功。Gateway 停机时先拒绝新回调并返回 503，再等待已经确认的同步队列排空，避免“企微认为已送达、进程却尚未处理”的消息丢失。

## 出站网络策略

渠道级 `channels.wecom-kf.network` 可配置 `egressProxyUrl`、`timeoutMs`、`retries` 和
`retryDelayMs`，账号级 `accounts.*.network` 可覆盖。只有 token、`sync_msg`、媒体下载和列表
查询允许对 429、5xx、网络失败做有限重试；发送、转接、上传和创建客服链接保持单次调用，避免
响应丢失时产生重复业务副作用。

```text
渠道 network + 账号 network
            │ 合并
            ▼
固定出口代理 / 超时 / 重试预算
            │
      ┌─────┴──────────────┐
      ▼                    ▼
读与同步请求            写与副作用请求
有限指数退避            不自动重试
      └─────┬──────────────┘
            ▼
access_token、corpsecret、代理密码写日志前统一脱敏
```

```mermaid
flowchart LR
    C["渠道 network"] --> M["账号合并"]
    A["账号 network"] --> M
    M --> H["代理与超时"]
    H --> D{"安全重试?"}
    D -->|"读/同步"| R["有限退避"]
    D -->|"业务写"| O["单次调用"]
    R --> L["凭据脱敏日志"]
    O --> L
```

## 生产边界

- 回调必须验签、解密、限制请求体，并对消息 ID 和游标做幂等处理。
- 多账号回调路径必须唯一绑定账号；解密事件的 `OpenKfId` 与绑定值不一致时在 ACK 前拒绝，不能据此切换账号凭据。
- `send_msg` 在调用 API 前按会话原子预占 48 小时窗口内的 5 条回复额度；失败时回滚，避免并发请求突破上限。
- access_token 缓存按 `corpId + corpSecret + apiBaseUrl` 的不可逆指纹隔离，凭据轮换或切换私有化网关后不会继续复用旧 token。
- 本地媒体读取必须经过白名单、真实路径、符号链接逃逸与大小限制检查。
- `corpSecret`、Token、EncodingAESKey 属于敏感配置，不应写入日志或状态接口。
- 外部联系人 ID 不进入常规策略日志；第三方异常先清除 URL 凭据、查询参数、控制字符并截断后再记录。
- 转人工是控制面动作，工具结果不应混入用户可见的 LLM transcript。
- 必须验证游标恢复、企业微信重试、Gateway 重启和人工接管后的消息归属。

## 验证

```bash
openclaw plugins doctor
openclaw channels status --probe
pnpm --filter @partme.ai/wecom-kf typecheck
pnpm --filter @partme.ai/wecom-kf test
pnpm --filter @partme.ai/wecom-kf build

# 安装态协议闭环
OPENCLAW_E2E_HOST_GATEWAY=1 node scripts/e2e/run-e2e.mjs --plugins wecom-kf --skip-browser
```

环境验收至少覆盖：文本与媒体、重复回调、游标续拉、欢迎语、排队、结束会话、满意度事件、自动选席、转人工和 48 小时窗口。
