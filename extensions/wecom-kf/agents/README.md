# wecom-kf 客服智能体 (WeCom KF Agents)

> 面向企微客服等渠道的售前 / 售后智能体集合：售前 5 种风格 + 售后 5 种风格，共 10 个。与 openclaw-plugins/wecom-kf 插件配合使用，可绑定到不同客服账号或场景。

## 智能体清单

| 序号 | Agent id | 展示名 | 目录 | 职责摘要 |
|------|----------|--------|------|----------|
| 1 | presale-warm | 售前-小暖 | 1-presale-warm | 售前：温暖、贴心、耐心，偏小暖式咨询与引导 |
| 2 | presale-professional | 售前-小专 | 2-presale-professional | 售前：简洁、数据与方案导向、专业介绍 |
| 3 | presale-energetic | 售前-小活 | 3-presale-energetic | 售前：热情、主动推荐、年轻化沟通 |
| 4 | presale-steady | 售前-小稳 | 4-presale-steady | 售前：稳重、可靠、不夸大，稳妥介绍 |
| 5 | presale-consultative | 售前-小顾 | 5-presale-consultative | 售前：引导式、需求挖掘、方案建议 |
| 6 | aftersale-considerate | 售后-小贴 | 6-aftersale-considerate | 售后：同理心强、安抚为主、关怀式服务 |
| 7 | aftersale-efficient | 售后-小捷 | 7-aftersale-efficient | 售后：快速响应、流程清晰、高效处理 |
| 8 | aftersale-patient | 售后-小耐 | 8-aftersale-patient | 售后：细致、不厌其烦、耐心解答 |
| 9 | aftersale-accountable | 售后-小当 | 9-aftersale-accountable | 售后：主动跟进、闭环、有担当 |
| 10 | aftersale-gentle | 售后-小柔 | 10-aftersale-gentle | 售后：语气柔和、化解矛盾、温和沟通 |

## 配置说明

- **Workspace**：各智能体 workspace 指向本目录下对应子目录（如 `<REPO_ROOT>/openclaw-plugins/wecom-kf/agents/1-presale-warm`），或部署时复制/链接到 `~/.openclaw/workspace-<agent-id>`。
- **Config 片段**：可合并进主 openclaw 配置；每个 `channels.wecom-kf.accounts.{accountKey}` 需配置 `openKfId` 与 `agentId`（一客服账号一 OpenClaw Agent），可选 `agentMapping` 做接待人员级覆盖。
- **话术与知识库**：需在各自工作区的 `TOOLS.md` 或 openclaw 配置中配置；回复仅以已配置的话术与知识库为准，不杜撰、不越权承诺，该转人工则转人工。

若需模型、工具、会话、Memory Search 等运行时配置，可参考仓库内 `templates/presale-agent`、`templates/aftersale-agent`。

## 初始化命令

以下命令在 OpenClaw 配置已就绪的前提下执行；`--workspace` 使用本地路径，需先将本仓库 `agents/<N-xxx>` 复制或链接到对应 workspace 目录。

### 1. 查看当前智能体列表

```bash
openclaw agents list
```

### 2. 添加 wecom-kf 客服智能体（10 个）

```bash
openclaw agents add presale-warm           --workspace ~/.openclaw/workspace-presale-warm;
openclaw agents add presale-professional  --workspace ~/.openclaw/workspace-presale-professional;
openclaw agents add presale-energetic     --workspace ~/.openclaw/workspace-presale-energetic;
openclaw agents add presale-steady        --workspace ~/.openclaw/workspace-presale-steady;
openclaw agents add presale-consultative  --workspace ~/.openclaw/workspace-presale-consultative;
openclaw agents add aftersale-considerate --workspace ~/.openclaw/workspace-aftersale-considerate;
openclaw agents add aftersale-efficient   --workspace ~/.openclaw/workspace-aftersale-efficient;
openclaw agents add aftersale-patient     --workspace ~/.openclaw/workspace-aftersale-patient;
openclaw agents add aftersale-accountable --workspace ~/.openclaw/workspace-aftersale-accountable;
openclaw agents add aftersale-gentle      --workspace ~/.openclaw/workspace-aftersale-gentle;
```

### 3. 查看当前绑定

```bash
openclaw agents bindings
```

### 4. 按渠道绑定智能体（示例：wecom-kf）

`bindings.match.accountId` 使用配置键 `channels.wecom-kf.accounts.{accountKey}`（推荐），也可与 `open_kfid` 对齐：

```json
{
  "bindings": [
    {
      "agentId": "presale-warm",
      "match": { "channel": "wecom-kf", "accountId": "presale-desk" }
    },
    {
      "agentId": "aftersale-efficient",
      "match": { "channel": "wecom-kf", "accountId": "support-desk" }
    }
  ]
}
```

对应 `openclaw.json` 片段：

```json
{
  "channels": {
    "wecom-kf": {
      "corpId": "ww_xxx",
      "corpSecret": "xxx",
      "token": "回调Token",
      "encodingAESKey": "AES密钥",
      "defaultAccount": "presale-desk",
      "accounts": {
        "presale-desk": {
          "openKfId": "wk_presale_001",
          "agentId": "presale-warm"
        },
        "support-desk": {
          "openKfId": "wk_support_001",
          "agentId": "aftersale-efficient"
        }
      }
    }
  }
}
```

CLI 绑定示例（accountKey 与配置键一致）：

```bash
openclaw agents bind --agent presale-warm --bind wecom-kf:presale-desk;
openclaw agents bind --agent aftersale-efficient --bind wecom-kf:support-desk;
```

环境变量（`WECOM_KF_*`）仅作为 **default** 单账号模式的回退，多账号场景请在 `accounts` 中显式配置。

## 文件结构（每智能体）

- `AGENTS.md` — **英文**，角色定义、职责、边界、Session Startup、Memory、Red Lines、External vs Internal、Group Chats、Tools、Heartbeats；供 OpenClaw 系统提示词注入
- `zh-CN/AGENTS.md` — **中文**，与 AGENTS.md 内容等价，供团队阅读
- `SOUL.md` — 人格与风格、底线（建议在 `zh-CN/` 下提供 SOUL.md 中文版）
- `zh-CN/SOUL.md` — 中文等价
- `IDENTITY.md` — **英文**，Who Am I?（Name/Creature/Vibe/Emoji/Avatar）+ Purpose、When to Invoke、Expertise、Deliverables
- `zh-CN/IDENTITY.md` — **中文**，我是谁？+ 职责/何时调用/专长/产出
- `TOOLS.md` — 话术库、知识库路径或 ID、升级规则等本地备注
- `USER.md` — 所服务对象/配置者信息（内部用，不暴露给客户）
- `BOOTSTRAP.md` — 首次运行引导，完成后可删除
- `HEARTBEAT.md` — 心跳任务说明（英文）；留空或仅注释即不执行
- `zh-CN/HEARTBEAT.md` — 心跳任务说明（中文对照）

**中英文约定**：英文文件在智能体根目录，中文版集中在 `zh-CN/` 子目录下，文件名与英文一致，便于将 `zh-CN/` 整目录拷贝到业务使用。
