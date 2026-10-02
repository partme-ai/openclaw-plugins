# U9 本地多写入者与受保护代理探测

日期：2026-10-02。对应 [OpenClaw 2026.9.6 升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md) 的 U9 和 [实施计划](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md) Task 9。测试使用本机隔离进程和临时数据目录，未使用个人 Gateway、厂商账号或生产数据；安装态 E2E 使用独立 `queue-e2e` Gateway profile。初始探测结束后，OpenMem 已在隔离工作树继续补充生产入口与 HTTP 边界测试。

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

## 生产入口半提交与 HTTP 边界补测

OpenMem 隔离工作树追加 `1cf0d23`：真实 `dist/index.js` 进程取得单写入者锁后，临时撤销 `memories/` 目录的写权限，使归档 JSON/Markdown 和提交快照已落盘、事实 JSON 尚未写入时，提交返回 HTTP 500。保持故障至 `SIGKILL`，恢复权限，新生产进程接管同一目录。两次 POST 重放保持同一归档/事实 ID，唯一 JSON/Markdown 和 `ARCHIVED` 终态成立；直接查询 SQLite FTS 得到事件、归档、事实各一行，全文 `MATCH` 三行。新增用例独立连续 5 次通过，独立审查 Spec PASS、Quality APPROVE。它验证本机权限故障与进程接管，不是实际断电。

本机探测旧生产入口时，日志声称 `127.0.0.1`，`lsof` 却显示 `TCP *:53970 (LISTEN)`；旧 HTTP 应用对任意 Origin 的预检返回 204 与 `Access-Control-Allow-Origin: *`，跨站表单 POST `/sessions/start` 返回 201。OpenMem 提交 `4af8490`、`b583486` 将生产入口默认绑定 `127.0.0.1`，外部接口需显式 `OPENMEM_HOST`，日志读取实际绑定地址；`0afdd62` 使工作记忆 GET 不落盘，未知会话 404，已有会话缺失记录时返回稳定空视图，API 空 ID 语义已写入 OpenMem README。`1eec6b7`、`ad9cb0d` 在所有 HTTP 路由前校验原始 Host/Origin 与 Fetch Metadata，拒绝不可信和 `null` Origin、跨站表单及 DNS rebinding Host；受保护代理 Host/Origin 须显式列入允许列表，CLI/Gateway 无 Origin 请求保持可用。后续独立安全审查以真实 HTTP 探测五种拒绝路径，均返回 403，事后会话数为 0；Spec PASS、Quality APPROVE，Critical/Important/Minor 均为 0。Host/Origin 防护不是请求鉴权，显式开放外部 Host 时仍需认证代理与网络隔离。

合并后的 OpenMem `pnpm test`：Core 16/16、Server 33/33，完整 `pnpm build` 退出 0（Web 构建存在非失败的 Sass/Browserslist/体积警告）。最终候选物再次执行 `OPENMEM_E2E_REPO=... node scripts/e2e/run-e2e.mjs --plugins openmem`：OpenClaw 2026.9.6、Node v24.18.0，插件单元 47/47，tarball 安装态 Gateway Agent Turn、归档、Gateway 重启后下一轮连续性均 PASS；`skipCount=0`、`skipInstall=false`、`skipBrowser=false`。归档为 `scripts/e2e/reports/2026-10-02T10-49-03.232Z-openmem-0e293449-4d85-4364-801f-f390f8faaafd.json`；`node scripts/check-e2e-evidence.mjs` 对 27 个运行时插件候选物退出 0。此 E2E 的 Sidecar 仍由程序化 `createApp` 启动，生产入口锁和监听防护由上面的真实进程测试单独证明。OpenMem 仓库 `lint` 命令因未安装 ESLint 无法执行；没有据此声称 lint 通过，也未安装新依赖。

## 验收结论

本地单写入者、生产入口半提交恢复、默认回环监听、Host/Origin 防护及测试代理上的 TLS/令牌/重放探测通过。**旧入口的多写入者共享数据目录在本机复现 HTTP 500；新生产入口以运行时锁强制每个数据目录单写入者，第二实例在监听前拒绝。** 直接调用 Sidecar 引擎的其他入口不受该锁保护。Task 9 的跨主机/网络卷单写入约束、真实断电/部署恢复和受保护网络验收保持未完成；本地测试代理不得记为预发或生产验收。

真实厂商回调继续以 [本地 Gateway、Sidecar 与回调夹具复验](2026-10-02-local-gateway-sidecar-callbacks.md) 的本机夹具结果为准。没有厂商平台实际投递证据。
