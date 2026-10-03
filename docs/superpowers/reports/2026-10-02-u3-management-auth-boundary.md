# U3 Router / Tracing 管理接口鉴权阶段记录

日期：2026-10-02。对应稳定版升级规格 U3 与实施计划 Task 3。本记录是阶段证据；Router 真实安装态 E2E 已通过，Tracing/MQTT 被候选包审查门禁拦在安装阶段，不代表 U3 完成。计划 checkbox 与 ledger 保持原状。

## 当前源码与独立验证

- Router 的五条管理路由均为 `auth: "gateway"`、`match: "exact"`，见 `extensions/router/src/index.ts:325-392`；单测断言全部路由元数据，见 `extensions/router/test/index.test.ts:9-26`。重放仅允许 POST。
- Tracing 的三条查询路由均为 `auth: "gateway"`、`match: "exact"`，见 `extensions/tracing/src/index.ts:357-361`；单测见 `extensions/tracing/src/index.test.ts:37-77`。
- Router E2E `scripts/e2e/plugins/router.mjs` 经实际 Gateway HTTP 入口请求匿名 GET、匿名/无效 bearer/伪造 Cookie POST、授权查询及一次重放；拒绝请求前后比较投递计数和 DLQ 明细，最终检查 Gotify 中重放消息恰好一条。Tracing E2E `scripts/e2e/plugins/tracing.mjs` 对三条 GET 检查匿名/无效 bearer 拒绝，并检查匿名 POST 拒绝、授权 POST 为 405、授权 GET 和 `tracing,mqtt` Agent turn 的 Collector OTLP 数据；Tracing 这些运行态断言尚未执行。
- `pnpm --dir extensions/router test`：5 文件、63/63 PASS，退出 0；`pnpm --dir extensions/router typecheck`：PASS，退出 0。
- `pnpm --dir extensions/tracing test`：7 文件、73/73 PASS，退出 0；`pnpm --dir extensions/tracing typecheck`：PASS，退出 0。
- 两个 E2E 脚本 `node --check`、`git diff --check`、`pnpm check-explanatory-assets`：PASS，退出 0。后者包含 Tracing 共享 journal 文件级中文职责说明检查。

## 真实安装态 E2E 结果

| 命令 | 结果 | 实际边界 |
| --- | --- | --- |
| `node scripts/e2e/run-e2e.mjs --plugins router` | FAIL，退出 1 | 配置阶段提示 `router E2E requires --plugins router,gotify`；未进入 Gateway 鉴权用例。计划中的单插件命令需按当前组合约束更正。 |
| `node scripts/e2e/run-e2e.mjs --plugins router,gotify` | FAIL，退出 1 | 本机 18080 被另一 Docker 服务占用，Gotify fixture 未能启动；不代表插件鉴权失败。 |
| `E2E_GOTIFY_PORT=18081 GOTIFY_URL=http://127.0.0.1:18081 node scripts/e2e/run-e2e.mjs --plugins router,gotify` | PASS，退出 0；Router/Gotify 两行 PASS，skipCount=0 | 四条 Router 匿名 GET 均 401；匿名、无效 bearer、伪造 Cookie replay POST 均 401；拒绝请求后投递计数和 DLQ 明细不变；授权 replay 202、`replayed=1`，Gotify 仅收到一条对应重放消息。归档：`scripts/e2e/reports/2026-10-01T16-24-10.950Z-router+gotify-65042da0-c0c0-44a1-8b8e-89c1ca834009.json`。 |
| `node scripts/e2e/run-e2e.mjs --plugins tracing,mqtt` | FAIL，退出 1 | Tracing 73/73 单测、typecheck、build、pack 均通过；安装前 `trustedE2ELinkArgs` 因候选包摘要与审查 allowlist 不同而拒绝能力同意。Gateway/OTLP 断言未运行，MQTT 尚未安装。 |

Tracing 被拒绝的候选归档：`scripts/e2e/reports/candidates/8ab332b0-fad0-4023-9628-f45c4ee2e343-tracing.tgz`；tarball SHA-256 `ffc4ccfd69b4d1d854b509377abf6d43782bbcd50bb68247c9b323f0aa877526`；`reviewedArtifactDigest` 为 `43cfd365515cc84e64cab55b72e4d0724ac759b10d4c681196d580128a534d17`，旧 allowlist 为 `603e57996443a8eff0fc3cc7364579fa0a66dfef000f4ecb062a7487983bf895`。未绕过门禁；该归档需独立复核后才能更新 allowlist 并重跑。两个运行的 Compose 均执行 `down`，结束后 `docker ps` 未见 `openclaw-e2e-*`，19789 无监听。

## 上游 2026.9.6 授权边界

上游源码根目录：`/Users/wandl/workspaces/workspace-octoclaw-labs/research/openclaw`，固定版本 `v2026.9.6`。以下是上游源码/测试证据，不等同本插件安装态结果。

1. Gateway 在插件处理器之前完成鉴权：`src/gateway/server-http.ts:625-666`。路由分发在未满足 Gateway 鉴权时拒绝，并按插件所有者匹配 browser grant：`src/gateway/server/plugins-http.ts:245-263`。
2. Gateway 只为已加载且允许的 Control UI asset，或同插件的 tab 所指 Gateway 路由签发只读 grant：`src/gateway/control-ui-plugin-tabs.ts:216-264`。当前插件源码执行 `rg -n 'registerControlUi|surface: "tab"|controlUi' extensions -g '*.ts' -g '*.json'` 返回 0；Router/Tracing 均无 Control UI descriptor。本轮独立 `router` 与 `tracing,mqtt` 场景无法从 Gateway 获取绑定它们管理路径的真实 browser grant。
3. Cookie 授权入口只接受 GET/HEAD：`src/gateway/http-auth-plugin-cookie.ts:36-49`。上游 Gateway handler 测试用真实签发 Cookie 验证 POST 返回 401、插件处理器未运行：`src/gateway/server.plugin-frame-auth.test.ts:370-400`。因此伪造 Cookie 负例不可冒充真实 browser grant 验收。
4. Gateway 签发的插件 Cookie TTL 是五分钟：`src/gateway/control-ui-plugin-frame-contract.ts:1-2`、`src/gateway/control-ui-plugin-auth-cookie.ts:103-126`；验证在 `exp <= now` 时拒绝：同文件 `:192-253`。本仓库 E2E 为 Router/Tracing 配置随机静态 Gateway bearer token：`scripts/e2e/lib/config.mjs:12-13,68-84`。上游 `src/gateway/auth-resolve.ts:15-29` 的共享 token 模式没有过期时间。因此 `invalid-e2e-token` 只能称为无效凭据，不能称为过期 token。

## 待执行与验收边界

- 独立复核 Tracing 候选摘要并更新 consent 后，重新独占执行 `node scripts/e2e/run-e2e.mjs --plugins tracing,mqtt`，记录真实 Gateway 响应与 Collector OTLP 结果；目前这部分仍为待验证。
- 如必须取得真实只读/过期 grant 的本仓库安装态证据，可在隔离 E2E profile 加入只用于测试的 Control UI fixture 插件，让 Gateway 通过 Control UI 读入口签发 Cookie；先证实该 Cookie 可读其自身 GET，再向 Router replay POST，检查拒绝和 DLQ 不变。此方案需扩展 E2E 安装/配置编排，证明的是跨插件与只读拒绝；不证明 Router 同插件 grant。过期验证需使用该真实 Cookie 的 TTL，不能用随机 bearer 替代。
- 规格中的“过期 token POST”与当前静态 bearer token 模式不相符，Router/Tracing 也没有产品 Control UI descriptor。U3 严格门槛暂不勾选；是否调整验收方式由主任务与用户确认。
