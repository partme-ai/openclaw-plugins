---
name: transfer-to-human
description: 微信客服转人工。当用户明确要求转人工（如「转人工」「人工客服」「人工」）或问题超出 AI 能力时激活，按接待人员列表与会话状态执行转接（指定坐席或排队），并回复客户。
metadata:
  {
    "openclaw":
      {
        "emoji": "👤",
        "always": false
      }
  }
---

# 转人工（微信客服）

在 wecom-kf 渠道下，当客户要求转人工或问题超出 AI 能力时，按本 skill 执行转接逻辑。依赖企微 API：获取接待人员列表（94645）、分配客服会话（94669）。

## 意图处理

当出现以下情况时**激活**本 skill：

- 用户明确表达转人工：如「转人工」「人工客服」「人工」「找人工」「转接人工」等。
- 问题超出当前 AI 能力：无法准确回答、需人工核实、投诉/退款等敏感场景。

若运行环境为 OpenClaw 且渠道注入了转人工工具，优先**调用该工具**（传入当前会话的 open_kfid、external_userid 等）；否则按下方工作流，结合环境中的 access_token 与会话信息构造请求。

## 工作流

### 1. 获取当前客服账号的接待人员列表

- **API**：获取接待人员列表，文档 [94645](https://developer.work.weixin.qq.com/document/path/94645)。
- 请求需：`access_token`、`open_kfid`（当前客服账号 ID）。
- 解析返回的 `servicer_list`，筛选 **`status === 0`**（接待中）的坐席；`status === 1` 表示停止接待。

### 2. 根据结果决定转接方式

**有在线坐席**（存在 `status === 0` 的接待人员）：

- 调用「分配客服会话」接口（文档 [94669](https://developer.work.weixin.qq.com/document/path/94669)），将会话转给指定坐席：
  - `service_state = 3`（由人工客服接待）
  - `servicer_userid` = 所选坐席的 `userid`（必须在该客服账号的接待人员列表中）。
- 回复客户：如「正在为您转接人工客服 [坐席名称]，请稍候。」

**无在线坐席**：

- 调用同一接口，将会话转入待接入池排队：
  - `service_state = 2`（待接入池），不传 `servicer_userid`。
- 回复客户：如「当前人工客服暂时不在线，已为您排队等候。我会继续为您解答。」

### 3. 转接后的行为

- 会话变为 `service_state = 3` 后，后续该客户的消息由人工接待，插件侧会跳过 AI 回复（见 message-handler 中的 state 判断）。
- Agent 在转接完成后无需再对该会话主动回复，避免与人工重复。

## 业务知识（API 约定）

- **servicer/list（94645）**：`status = 0` 接待中，`status = 1` 停止接待。
- **service_state/trans（94669）**：`service_state = 2` 排队，`service_state = 3` 转人工；为 3 时 **必须** 传 `servicer_userid`，且该 userid 须在当前客服账号的接待人员列表中。
- 接待人员需在应用可见范围内，否则无法被指定转接。

## 错误处理

- 若调用分配会话接口返回业务错误码，将错误信息中的可读说明回复给客户，并建议稍后重试或留下联系方式。
- 若 access_token 或 open_kfid 不可用，提示「转接服务暂时不可用，请稍后再试或联系管理员。」

## 注意事项

- 本 skill 仅适用于 **wecom-kf** 渠道；其他渠道请勿套用。
- 所有企微 API 的 path 与参数以官方文档为准，见 [references/kf-api.md](references/kf-api.md)。
