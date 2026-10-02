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

## 验收结论

本地单写入者的指定故障恢复，以及测试代理上的 TLS/令牌/重放探测通过。**多写入者共享数据目录在本机稳定复现 HTTP 500，因此每个数据目录必须限制为单个 Sidecar 写入者。** 当前源码中的这一部署假设不是自动强制的运行时锁。Task 9 的多写入者、真实断电/部署恢复和受保护网络验收保持未完成；本地测试代理不得记为预发或生产验收。

真实厂商回调继续以 [本地 Gateway、Sidecar 与回调夹具复验](2026-10-02-local-gateway-sidecar-callbacks.md) 的本机夹具结果为准。没有厂商平台实际投递证据。
