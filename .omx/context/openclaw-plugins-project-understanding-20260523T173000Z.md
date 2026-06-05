# openclaw-plugins 项目理解上下文快照

> 生成时间：2026-05-24（会话续跑）  
> 工作目录：`/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins`  
> 分支：`feature/v2026-05-22`（HEAD `d6397db`）

---

## Task Statement

对 `openclaw-plugins` monorepo 做一次**完整、可复用**的项目理解与开发上手报告：覆盖包结构、构建/测试、OpenClaw 插件运行时接入模式、`message-sdk` 定位、`wecom` vs `wecom-kf` 边界、legacy/ics/intelligence 目录角色、安全边界与 Phase 路线图。**不改业务代码、不 commit。**

---

## Desired Outcome

1. 本快照文件（`.omx/context/...`）供后续 Ralph/Agent 续跑引用  
2. 中文详细报告：事实引用具体路径，含 wecom-kf Phase 1–4 状态、测试基线、P0/P1 架构审查项  
3. 只读验证：`wecom-kf` 166 tests + typecheck 通过（2026-05-24 本地执行）  
4. Ralph 报告质量判定 + remaining questions

---

## Known Facts / Evidence

### Monorepo 根

| 项 | 证据 |
|----|------|
| 包管理 | `package.json`：`pnpm@9.0.0`，`engines.node >=22` |
| Workspace | `pnpm-workspace.yaml`：`extensions/*`、`test-utils` |
| 根脚本 | `pnpm build`（`-r build`）、`typecheck`、`lint`、`new-plugin`、`publish-changed`、`sync-message-sdk-deps` |
| 插件数量 | `README.zh-CN.md`：28 个独立 npm 包 + `message-sdk` 共享库 |
| 插件契约 | `spec/PLUGIN_SPEC.md` |

### OpenClaw 插件接入模式（以 wecom-kf 为例）

| 机制 | 文件 |
|------|------|
| Manifest | `extensions/wecom-kf/openclaw.plugin.json`（id、channels、contracts.tools、configSchema） |
| 入口 | `extensions/wecom-kf/index.ts` → `register(api)` |
| Channel | `api.registerChannel({ plugin: wecomPlugin })` ← `src/channel.ts` |
| HTTP 路由 | `api.registerHttpRoute`：KF `collectWecomKfRoutePaths`；可选 legacy CS；可选 ICS |
| Tools | `api.registerTool`：`wecom_kf_mcp`、`wecom_kf_list_*`、`wecom_kf_transfer_session` |
| Hooks | `api.on("before_prompt_build")`：MEDIA 说明 + `intelligence/hooks.ts` 状态注入 |
| Outbound | `src/outbound/index.ts`、`src/outbound/kf-send.ts` |

`wecom` 对照：`extensions/wecom/src/index.ts` 使用 `defineChannelPluginEntry` + `registerFull`（Bot/Agent webhook、`wecom_mcp`、MEDIA/卡片 prompt）。

### message-sdk

| 项 | 证据 |
|----|------|
| 包名 | `@partme.ai/openclaw-message-sdk` v2026.5.22 |
| 定位 | `extensions/message-sdk/README.md`：UnifiedMessage、媒体解析、bridge、ingress、dedup |
| Bridge API | `extensions/message-sdk/src/bridge/index.ts`：`dispatchInbound`、`createReplyHandler` |
| 消费方式 | 各 extension `package.json`：`workspace:^2026.5.22` |

### wecom vs wecom-kf

| 维度 | wecom | wecom-kf |
|------|-------|----------|
| 渠道 ID | `wecom` | `wecom-kf` |
| 协议 | Bot JSON + Agent XML + WS | 企微 KF API（97712 回调 + sync_msg） |
| MCP Tool | `wecom_mcp` | `wecom_kf_mcp` |
| Control Tools | 无 KF 专用 | `wecom_kf_*`（`kf/control-tools.ts`） |
| Legacy CS | N/A | `legacyWecomCsEnabled` 默认 false（`config/kf-routes.ts`） |

### wecom-kf Phase 状态（Roadmap + 代码）

| Phase | 文档状态 | 代码观察 |
|-------|----------|----------|
| **0–1** | ✅ 完成 | KF 路由、callback、accounts、control-tools 注册 |
| **2** | 部分完成 | `legacy/monitor.ts` 仍 ~3005 行；`src/monitor.ts` 为 re-export shim；`index.ts` 仍注册 legacy 路由（当 flag=true）；`dispatch.ts` 未用 `dispatchInbound`（仅 `webhook/handler.ts` 内部函数同名） |
| **3** | ✅ 文档标记完成 | `intelligence/`、`kf/session-*`、`icsEnabled` 开关 |
| **4** | 进行中 | `probe.ts` 存在；P4-03~06 文档标 Ralph 进行中 |

### 测试基线（2026-05-24 本地）

```text
cd extensions/wecom-kf && pnpm test
→ 34 files, 166 passed
pnpm typecheck → exit 0
```

### 近期 commits（wecom-kf）

- `1b3e48a` feat: Phase 3 session state + Phase 4 subset  
- `4863c2d` refactor: wecom-cs → wecom-kf naming  
- `91e8a07` refactor: remove admin api layer, servicer cache → kf/  
- `d6397db` refactor: remove plugin-sdk-shim, direct SDK imports  

### 安全边界（已实现）

- Control Tools：`kf/control-tools.ts` → `content: []` + `isolatedAck` + `[wecom_kf:audit]` 日志  
- CallContext：`kf/call-context.ts` → `agentAccountId`=open_kfid，`requesterSenderId`=external_userid  
- Multi-account fail-closed：`config/routing.ts` → matrix 模式默认 `failClosedOnDefaultRoute=true`  
- ICS 默认关：`isIcsEnabled()` → `icsEnabled === true` 才注册 `/ics/*`

### 安全边界（差异/风险）

- `wecom_kf_mcp`（`mcp/tool.ts`）返回 `content: [{ type: "text", text: JSON.stringify(...) }]` — **非** control-tools 隔离策略  
- `channel.ts` 仍引用 `gateway-monitor.js`、`legacy/onboarding.js` 的 Bot/WS setup 路径  

---

## Constraints

- 不修改业务代码、不 git commit  
- 不安装依赖、不跑全量 monorepo build（仅 wecom-kf 单包 test/typecheck）  
- 陈述限于已读文件与命令输出；未做真实企微联调  

---

## Unknowns / Open Questions

1. 真实企微环境联调 Checklist（`doc/wecom-kf/Integration-Checklist.md`）哪些项已在生产验证？  
2. `dispatch.ts` 何时完全切换至 `message-sdk` `dispatchInbound` / `createReplyHandler`？Roadmap P2-04 无明确 PR。  
3. Legacy `legacy/monitor.ts` 删除时间表：测试仍依赖 `legacy/monitor.*.test.ts`。  
4. `wecom_kf_mcp` 是否应对客服 Agent allowlist 禁用或同样 redact？Tools 架构文档 §0.1 仍引用已废弃的 `kf/tools.ts` 注册。  
5. Phase 4 并发 limit（P4-04）与 `apiBaseUrl` 私有化（P4-03）实现进度需读 `webhook/handler.ts` 并发逻辑与单测。  
6. CI（`.github/workflows/ci.yml`）按变更插件矩阵构建，非全量；本地 `pnpm -r typecheck` 未在本会话执行。  

---

## Likely Codebase Touchpoints

### 新贡献者入门

- `README.zh-CN.md`、`doc/OpenClaw-Plugins-Architecture_CN.md`  
- `spec/PLUGIN_SPEC.md`、`extensions/_template/`  
- `extensions/message-sdk/docs/ARCHITECTURE.md`（若存在）

### wecom-kf 核心路径

- 注册：`index.ts`  
- 回调：`src/webhook/callback.ts`、`src/webhook/handler.ts`  
- 派发：`src/dispatch.ts`  
- API：`src/agent/api-client.ts`  
- 控制面：`src/kf/control-tools.ts`、`src/kf/call-context.ts`  
- 配置：`src/config/accounts.ts`、`src/config/kf-routes.ts`、`src/config/routing.ts`  

### wecom-kf 清理/Phase 2–4

- `src/legacy/monitor.ts`、`src/gateway-monitor.ts`、`src/ws-adapter.ts`  
- `src/monitor.ts`（shim）  
- `src/channel.ts`（legacy onboarding / monitorWecomProvider）  
- `doc/wecom-kf/OpenClaw-WeCom-KF-Roadmap.md` 任务表 P2-01~P2-13、P4-01~P4-06  

### 文档

- `doc/wecom-kf/OpenClaw-WeCom-KF-Master-Architecture.md`  
- `doc/wecom-kf/OpenClaw-WeCom-KF-Tools-Architecture.md`  
- `doc/wecom-kf/Integration-Checklist.md`  

---

## Files Inspected (partial)

`package.json`, `pnpm-workspace.yaml`, `README.zh-CN.md`, `spec/PLUGIN_SPEC.md`, `.github/workflows/ci.yml`,  
`extensions/message-sdk/package.json`, `extensions/message-sdk/README.md`, `extensions/message-sdk/src/bridge/index.ts`,  
`extensions/wecom/package.json`, `extensions/wecom/src/index.ts`,  
`extensions/wecom-kf/package.json`, `extensions/wecom-kf/openclaw.plugin.json`, `extensions/wecom-kf/index.ts`,  
`extensions/wecom-kf/README.zh-CN.md`, `extensions/wecom-kf/src/channel.ts`, `extensions/wecom-kf/src/config/*`,  
`extensions/wecom-kf/src/kf/control-tools.ts`, `extensions/wecom-kf/src/kf/call-context.ts`,  
`extensions/wecom-kf/src/intelligence/hooks.ts`, `extensions/wecom-kf/src/ics/register.ts`,  
`extensions/wecom-kf/src/dispatch.ts`, `extensions/wecom-kf/src/mcp/tool.ts`, `extensions/wecom-kf/src/monitor.ts`,  
`doc/wecom-kf/OpenClaw-WeCom-KF-Roadmap.md`, `doc/wecom-kf/OpenClaw-WeCom-KF-Master-Architecture.md`,  
`doc/wecom-kf/OpenClaw-WeCom-KF-Tools-Architecture.md`, `doc/wecom-kf/Integration-Checklist.md`

**未全量扫描：** 其余 27 个 extension 源码、全 monorepo test、OpenClaw Gateway 运行时。
