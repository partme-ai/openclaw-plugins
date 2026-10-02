# U9 本地多写入者与受保护代理探测

日期：2026-10-02。对应 [OpenClaw 2026.9.6 升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md) 的 U9 和 [实施计划](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md) Task 9。测试仅访问本机 loopback 和独立临时目录，未使用个人 Gateway、厂商账号或生产数据。OpenMem 源码仓库测试后为干净的 `main`，测试进程和数据目录已清理。

## 运行结果

| 本地测试 | 实际结果 | 边界 |
| --- | --- | --- |
| `node scripts/session-commit-process-recovery.mjs`，OpenMem 仓库 | 退出 0，PASS。归档持久化后注入一次事实写入错误，`SIGKILL` Sidecar 进程，重启并重复提交；同一归档/事实 ID、唯一产物、Markdown、检索和 `ARCHIVED` 均通过 | 验证指定故障点的进程恢复；不是断电持久性 |
| `node /tmp/openmem-u9-multiwriter.mjs`，两进程共享数据目录、每会话 16 并发提交、3 轮 | 实现者执行：48 请求中 25×HTTP 500、23×HTTP 200，退出 1。独立复核重跑：21×HTTP 500、27×HTTP 200，退出 1。两轮均在 `FtsIndex.upsert → ExternalizationService.materializeCommit → OpenMemEngine.commitSession` 观察到 SQLite `errcode: 5 / database is locked` | **多写入者验收失败**。成功响应 ID 一致、每会话单归档/单事实、3/3 完成状态重启后同 ID 重放；不能据此声称并发安全 |
| `node .superpowers/sdd/2026-09-29-openclaw-2026-9-6-upgrade/u9-local-protected-proxy.mjs`，插件隔离工作树 | 退出 0，PASS。本地 HTTPS 测试代理拒绝匿名/错误 Bearer（均 401）；未信任证书被 `DEPTH_ZERO_SELF_SIGNED_CERT` 拒绝；正确凭据完成会话/事件/提交；同进程重建 Sidecar app/engine 后重放 ID 不变。直接检查唯一归档、事实、Markdown 和 SQLite FTS 中对应的两行内容 | 代理是测试脚本临时实现；没有真实部署代理、网络隔离或插件经代理的安装态请求。Sidecar 本地 HTTP 端口仍可绕过该代理 |
| `pnpm --dir extensions/openmem exec vitest run test/index.test.ts` | 35/35 PASS，退出 0；覆盖插件配置与认证头等单元行为 | 单元测试不能替代受保护网络部署 |
| `node scripts/check-e2e-evidence.mjs` | 27 个运行时插件的当前候选物与 OpenClaw 2026.9.6 证据匹配，退出 0 | 先前安装态场景仍为本地夹具；不代表厂商实网 |

多写入者探测的独立复核发现，FTS 的 `DELETE` 和 `INSERT` 不是一个事务，也没有 `doc_id` 唯一约束。本轮未观测到重复索引行，但仍可能在其他交错下出现重复或缺失。临时多写入者脚本的退出码仅由 HTTP 状态决定，其他一致性结果需结合 JSON 输出解读。两进程的 `SIGKILL` 发生在并发请求完成后，只证明完成状态的重启重放；前一项专用恢复脚本才覆盖归档后事实写入失败再重启的路径。专用恢复脚本通过 `/inspect/search` 验证检索命中，但该接口存在文件扫描回退，不能据此证明 FTS 索引完整。

## 单写入者生产入口防护

OpenMem 的隔离实施与独立审查已完成并推送，最终提交 `52145c4e2a819cdd3ba6769032c01a00a66975ac`。生产入口在构造引擎和监听前，先取得数据目录中独立 SQLite 锁文件的 `BEGIN IMMEDIATE` 写入者事务；同目录第二实例立即明确拒绝并退出 1。正常退出或 `SIGKILL` 后可接管。锁只保护该版本的生产入口；直接调用 `OpenMemEngine`/`createApp`、旧 Sidecar 和外部文件写入者仍可能绕开。

真实双进程测试先观察到第二实例错误监听（RED：1 failed/3 passed）。首版 `BEGIN EXCLUSIVE` 在竞争启动时又两次出现双实例都拒绝的真实失败；改为 `BEGIN IMMEDIATE` 后，同一 alias 并发测试连续 15/15 轮通过。最终 OpenMem Core 16/16、Server 14/14，构建和原半提交进程恢复脚本均退出 0。新增生产入口联合测试完成会话创建、事件摄取、成功提交、`SIGKILL`、接管及两次重放：归档和事实 ID 不变，唯一产物与 Markdown 保留，直接查询 FTS SQLite 得到事件、归档、事实各一行且全文匹配。它证明成功提交后的本地接管重放；没有在受保护生产入口中注入半提交故障或模拟断电。独立审查对最终实现给出 Spec PASS、Quality APPROVE，Critical/Important/Minor 均为 0；详细实施与审查记录位于本地 gitignored 的 `.superpowers/sdd/2026-09-29-openclaw-2026-9-6-upgrade/`。

使用最终 OpenMem 提交重新执行 `OPENMEM_E2E_REPO=... node scripts/e2e/run-e2e.mjs --plugins openmem`：OpenClaw 2026.9.6、Node v24.18.0 的 tarball 安装态 Gateway Agent Turn、归档和 Gateway 重启后续轮次均 PASS，`skipCount=0`；归档为 `scripts/e2e/reports/2026-10-02T08-49-10.208Z-openmem-568ce2c6-6715-4865-a629-4ba0e9a63195.json`。该 E2E 的 Sidecar 启动器通过 programmatic `createApp`，不经过新生产入口；锁接管由上述真实生产进程测试单独证明。`node scripts/check-e2e-evidence.mjs` 对当前 27 个插件候选物继续退出 0。

## 验收结论

本地单写入者的指定故障恢复，以及测试代理上的 TLS/令牌/重放探测通过。**旧入口的多写入者共享数据目录在本机复现 HTTP 500；新生产入口现在以运行时锁强制每个数据目录单写入者，第二实例在监听前拒绝。** 直接调用 Sidecar 引擎的其他入口不受该锁保护。Task 9 的跨主机/网络卷单写入约束、真实断电/部署恢复和受保护网络验收保持未完成；本地测试代理不得记为预发或生产验收。

真实厂商回调继续以 [本地 Gateway、Sidecar 与回调夹具复验](2026-10-02-local-gateway-sidecar-callbacks.md) 的本机夹具结果为准。没有厂商平台实际投递证据。
