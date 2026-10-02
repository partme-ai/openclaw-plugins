# U9 本地多写入者与受保护代理探测

日期：2026-10-02。对应 [OpenClaw 2026.9.6 升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md) 的 U9 和 [实施计划](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md) Task 9。测试使用本机隔离进程和临时数据目录，未使用个人 Gateway、厂商账号或生产数据；安装态 E2E 使用独立 `queue-e2e` Gateway profile。初始探测结束后，OpenMem 已在隔离工作树继续补充生产入口与 HTTP 边界测试。

## 运行结果

| 本地测试 | 实际结果 | 边界 |
| --- | --- | --- |
| `node scripts/session-commit-process-recovery.mjs`，OpenMem 仓库 | 退出 0，PASS。归档持久化后注入一次事实写入错误，`SIGKILL` Sidecar 进程，重启并重复提交；同一归档/事实 ID、唯一产物、Markdown、检索和 `ARCHIVED` 均通过 | 验证指定故障点的进程恢复；不是断电持久性 |
| `node /tmp/openmem-u9-multiwriter.mjs`，两进程共享数据目录、每会话 16 并发提交、3 轮 | 实现者执行：48 请求中 25×HTTP 500、23×HTTP 200，退出 1。独立复核重跑：21×HTTP 500、27×HTTP 200，退出 1。两轮均在 `FtsIndex.upsert → ExternalizationService.materializeCommit → OpenMemEngine.commitSession` 观察到 SQLite `errcode: 5 / database is locked` | **多写入者验收失败**。成功响应 ID 一致、每会话单归档/单事实、3/3 完成状态重启后同 ID 重放；不能据此声称并发安全 |
| `node .superpowers/sdd/2026-09-29-openclaw-2026-9-6-upgrade/u9-local-protected-proxy.mjs`，插件隔离工作树 | 退出 0，PASS。本地 HTTPS 测试代理拒绝匿名/错误 Bearer（均 401）；未信任证书被 `DEPTH_ZERO_SELF_SIGNED_CERT` 拒绝；正确凭据完成会话/事件/提交；同进程重建 Sidecar app/engine 后重放 ID 不变。直接检查唯一归档、事实、Markdown 和 SQLite FTS 中对应的两行内容 | 代理是测试脚本临时实现；没有真实部署代理、网络隔离或插件经代理的安装态请求。Sidecar 本地 HTTP 端口仍可绕过该代理 |
| `OPENMEM_E2E_REPO=... node scripts/openmem-protected-e2e.mjs`，插件隔离工作树 | OpenClaw 2026.9.6、插件单测 47/47、安装态 E2E PASS，跳过 0；代理转发 25 次、拒绝 2 次、同会话提交 3 次；证书未信任时连接失败，匿名/错误令牌均 401 | 临时本地代理和回环 Sidecar；证明实际安装插件流量经代理，不证明已部署的代理、跨主机存储或厂商回调 |
| `pnpm --dir extensions/openmem exec vitest run test/index.test.ts` | 35/35 PASS，退出 0；覆盖插件配置与认证头等单元行为 | 单元测试不能替代受保护网络部署 |
| `node scripts/check-e2e-evidence.mjs` | 27 个运行时插件的当前候选物与 OpenClaw 2026.9.6 证据匹配，退出 0 | 先前安装态场景仍为本地夹具；不代表厂商实网 |

多写入者探测的独立复核发现，FTS 的 `DELETE` 和 `INSERT` 不是一个事务，也没有 `doc_id` 唯一约束。本轮未观测到重复索引行，但仍可能在其他交错下出现重复或缺失。临时多写入者脚本的退出码仅由 HTTP 状态决定，其他一致性结果需结合 JSON 输出解读。两进程的 `SIGKILL` 发生在并发请求完成后，只证明完成状态的重启重放；前一项专用恢复脚本才覆盖归档后事实写入失败再重启的路径。专用恢复脚本通过 `/inspect/search` 验证检索命中，但该接口存在文件扫描回退，不能据此证明 FTS 索引完整。

## 单写入者生产入口防护

OpenMem 的隔离实施与独立审查已完成并推送，最终提交 `52145c4e2a819cdd3ba6769032c01a00a66975ac`。生产入口在构造引擎和监听前，先取得数据目录中独立 SQLite 锁文件的 `BEGIN IMMEDIATE` 写入者事务；同目录第二实例立即明确拒绝并退出 1。正常退出或 `SIGKILL` 后可接管。锁只保护该版本的生产入口；直接调用 `OpenMemEngine`/`createApp`、旧 Sidecar 和外部文件写入者仍可能绕开。

真实双进程测试先观察到第二实例错误监听（RED：1 failed/3 passed）。首版 `BEGIN EXCLUSIVE` 在竞争启动时又两次出现双实例都拒绝的真实失败；改为 `BEGIN IMMEDIATE` 后，同一 alias 并发测试连续 15/15 轮通过。最终 OpenMem Core 16/16、Server 14/14，构建和原半提交进程恢复脚本均退出 0。新增生产入口联合测试完成会话创建、事件摄取、成功提交、`SIGKILL`、接管及两次重放：归档和事实 ID 不变，唯一产物与 Markdown 保留，直接查询 FTS SQLite 得到事件、归档、事实各一行且全文匹配。它证明成功提交后的本地接管重放；没有在受保护生产入口中注入半提交故障或模拟断电。独立审查对最终实现给出 Spec PASS、Quality APPROVE，Critical/Important/Minor 均为 0；详细实施与审查记录位于本地 gitignored 的 `.superpowers/sdd/2026-09-29-openclaw-2026-9-6-upgrade/`。

使用最终 OpenMem 提交重新执行 `OPENMEM_E2E_REPO=... node scripts/e2e/run-e2e.mjs --plugins openmem`：OpenClaw 2026.9.6、Node v24.18.0 的 tarball 安装态 Gateway Agent Turn、归档和 Gateway 重启后续轮次上下文均 PASS，`skipCount=0`；归档为 `scripts/e2e/reports/2026-10-02T08-49-10.208Z-openmem-568ce2c6-6715-4865-a629-4ba0e9a63195.json`。当前 E2E 启动器 `scripts/e2e/helpers/openmem-sidecar.mjs` 启动真实 `apps/server/dist/index.js` 生产入口；同目录第二实例拒绝和故障接管由上述专门进程测试证明。`node scripts/check-e2e-evidence.mjs` 对当前 27 个插件候选物继续退出 0。

## 生产入口半提交与 HTTP 边界补测

OpenMem 隔离工作树追加 `1cf0d23`：真实 `dist/index.js` 进程取得单写入者锁后，临时撤销 `memories/` 目录的写权限，使归档 JSON/Markdown 和提交快照已落盘、事实 JSON 尚未写入时，提交返回 HTTP 500。保持故障至 `SIGKILL`，恢复权限，新生产进程接管同一目录。两次 POST 重放保持同一归档/事实 ID，唯一 JSON/Markdown 和 `ARCHIVED` 终态成立；直接查询 SQLite FTS 得到事件、归档、事实各一行，全文 `MATCH` 三行。新增用例独立连续 5 次通过，独立审查 Spec PASS、Quality APPROVE。它验证本机权限故障与进程接管，不是实际断电。

本机探测旧生产入口时，日志声称 `127.0.0.1`，`lsof` 却显示 `TCP *:53970 (LISTEN)`；旧 HTTP 应用对任意 Origin 的预检返回 204 与 `Access-Control-Allow-Origin: *`，跨站表单 POST `/sessions/start` 返回 201。OpenMem 提交 `4af8490`、`b583486` 将生产入口默认绑定 `127.0.0.1`，外部接口需显式 `OPENMEM_HOST`，日志读取实际绑定地址；`0afdd62` 使工作记忆 GET 不落盘，未知会话 404，已有会话缺失记录时返回稳定空视图，API 空 ID 语义已写入 OpenMem README。`1eec6b7`、`ad9cb0d` 在所有 HTTP 路由前校验原始 Host/Origin 与 Fetch Metadata，拒绝不可信和 `null` Origin、跨站表单及 DNS rebinding Host；受保护代理 Host/Origin 须显式列入允许列表，CLI/Gateway 无 Origin 请求保持可用。后续独立安全审查以真实 HTTP 探测五种拒绝路径，均返回 403，事后会话数为 0；Spec PASS、Quality APPROVE，Critical/Important/Minor 均为 0。Host/Origin 防护不是请求鉴权，显式开放外部 Host 时仍需认证代理与网络隔离。

合并后的 OpenMem `pnpm test`：Core 16/16、Server 33/33，完整 `pnpm build` 退出 0（Web 构建存在非失败的 Sass/Browserslist/体积警告）。最终候选物再次执行 `OPENMEM_E2E_REPO=... node scripts/e2e/run-e2e.mjs --plugins openmem`：OpenClaw 2026.9.6、Node v24.18.0，插件单元 47/47，tarball 安装态 Gateway Agent Turn、归档、Gateway 重启后下一轮上下文均 PASS；`skipCount=0`、`skipInstall=false`、`skipBrowser=false`。归档为 `scripts/e2e/reports/2026-10-02T10-49-03.232Z-openmem-0e293449-4d85-4364-801f-f390f8faaafd.json`；`node scripts/check-e2e-evidence.mjs` 对 27 个运行时插件候选物退出 0。此 E2E 的 Sidecar 经真实生产入口启动，因此覆盖正常启动时的锁和默认绑定；第二实例拒绝、故障接管与恶意 HTTP 请求由上面的专门进程/安全测试证明。OpenMem 仓库 `lint` 命令因未安装 ESLint 无法执行；没有据此声称 lint 通过，也未安装新依赖。

## 安装态插件经本地认证代理

插件仓库提交 `f61f8cf02572fa3e2f0969700672bc7617b6762b` 增加独立的 `scripts/openmem-protected-e2e.mjs`，提交 `bbc1cbed13798c48676477c0d5e4e1cc61291dc7` 修复独立审查发现的夹具误报和中断清理。它临时生成 SAN 为 `127.0.0.1` 的证书与随机 Bearer 令牌，在回环地址启动 HTTPS 代理，再以 OpenClaw 2026.9.6 安装 tarball 的 Gateway 和真实 `apps/server/dist/index.js` Sidecar 执行原有 OpenMem 场景。配置只保存令牌环境变量名。测试确认未信任证书失败，匿名及错误令牌均返回 401 且请求未到达 Sidecar，随后确认实际插件请求经代理转发；测试后删除临时证书和私钥。Sidecar 仍只在本机回环端口提供 HTTP，具备本机端口访问权的进程可绕过代理。

独立审查首轮发现旧 E2E 状态可能造成假阳性，以及重放两次都返回空事实列表仍会误判。修复后 wrapper 强制使用一次性的独立 profile，忽略外部 `OPENCLAW_E2E_PRESERVE_STATE=1`；adapter 用本轮 UUID 事件定位会话，重复提交要求非空事实 ID。另对 `SIGINT`/`SIGTERM` 增加子进程结束与临时证书清理，信号退出码分别为 130/143。定向测试 6/6 通过。受保护完整场景特意继承 `OPENCLAW_E2E_PRESERVE_STATE=1` 运行，退出后临时 profile 已删除。

最终受保护归档 `scripts/e2e/reports/protected/2026-10-02T11-40-35.823Z-openmem-ca39f47c-87c4-4ef9-93a7-a547c8ffb744.json` 为 PASS：插件单测 47/47、安装态 E2E `skipCount=0`，代理实际转发 25 次、拒绝 2 次；会话创建、事件摄取、归档、直接连续性检索和 Gateway 重启后的下一轮插件请求均通过代理路径。插件原始提交及两次重放使同一提交路由收到 3 次请求，重放归档与非空事实记忆 ID 保持一致。该归档绑定了 wrapper SHA-256、OpenClaw 版本、安装 tarball SHA-256 `1962e95f939a51910fa7b9ef75ca97ff29a37dbf577814c5fc379f3c69544cd6` 和原始安装态报告；配置、报告、Gateway 日志均未包含令牌。普通模式最终回归归档为 `scripts/e2e/reports/2026-10-02T11-41-43.267Z-openmem-ba0e66b9-69c7-4d7e-a906-837732419d7d.json`，PASS 且跳过 0；`node scripts/check-e2e-evidence.mjs` 在临时 profile 清理后对 27 个插件退出 0。独立复审为 Spec PASS、Quality APPROVE，无 Critical/Important 问题。通用 27 项证据门禁不检查此受保护 wrapper，本轮已单独核对其 SHA-256 与底层报告。

此场景中的 `/inspect/search` 请求是 E2E adapter 直接发出的 Sidecar API 断言；第二轮模型请求携带上一轮内容也可能来自 OpenClaw 自身 transcript。它们不能单独证明模型执行了插件 `openmem_search` 工具。后续已在[Task 8 工具调用复验](2026-10-02-openmem-installed-tool-e2e.md)中补上真实模型 tool call、Gateway 工具结果与代理检索 2xx 增量，并在共享输入变化后重跑全部 27 项安装态场景。

## 本机独立容器共享目录补测

OpenMem 隔离工作树新增 `scripts/session-commit-container-recovery.mjs`（提交 `8ac3d25388a4c2aee7da314531472d79c42b45d9`，审查修复 `07e8006389980955e878f02ee84fe5fe8a9f4136`）。执行 `node scripts/session-commit-container-recovery.mjs`：脚本用本机已安装的 pnpm 10.32.1 现场构建 Core/Server，随后在 `node:24.18.0-bookworm-slim` 镜像中以三个独立容器依次运行真实 `apps/server/dist/index.js` 生产入口。三个容器共享一次性 bind 数据目录，只通过 `docker exec` 访问容器内 loopback，不发布主机端口，也不拉取镜像。本轮容器 Node v24.18.0，镜像 ID `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`，Server 入口 SHA-256 `95fa905e24bb039f73644e5ec75c0af77487ac42553c0e02127c00f09313c851`。

修复版由实现者与主 Agent 分别完整执行，均退出 0 且输出 PASS：A 创建会话、摄取唯一事件并提交非空事实；A 存活期间 B 以退出码 1 和 active-writer 错误拒绝，当前源码与构建入口均确认取得租约在引擎创建和监听之前；`SIGKILL` A 后 C 接管，同一提交 POST 重放两次仍为原归档/事实 ID。目录内归档 JSON、事实 JSON、Markdown 各一份；直接 SQLite 查询和 FTS `MATCH` 均证实 event、archive、memory 各一行且内容命中本轮标记。脚本仅按随机所有权标签清理自己的容器；模拟 `docker rm` 失败时退出 1、保留诊断数据，SIGINT/SIGTERM 发生在 Docker 创建命令执行期间时分别以 130/143 退出并完成清理。独立复审给出 Spec PASS、Quality APPROVE，无 Critical/Important 问题；脚本输出中的 Git HEAD 只标识提交，脏工作树时不能单独当作源码指纹，现场构建才是本轮当前源码证据。

该补测证明**同一台 Mac 的 Docker Desktop bind mount** 上生产入口的容器间锁拒绝及接管；不是两个物理主机、NFS/SMB 网络卷或真实断电测试，也没有长期运行的受保护代理。本轮无 `openmem-recovery-*` 测试容器或脚本临时目录残留。

## 验收结论

本地单写入者、生产入口半提交恢复、默认回环监听、Host/Origin 防护及安装态插件经测试代理的 TLS/令牌/重放探测通过。**旧入口的多写入者共享数据目录在本机复现 HTTP 500；新生产入口以运行时锁强制每个数据目录单写入者，第二实例在监听前拒绝。** 直接调用 Sidecar 引擎的其他入口不受该锁保护。Task 9 的跨主机/网络卷单写入约束、真实断电/部署恢复和受保护网络验收保持未完成；本地测试代理不得记为预发或生产验收。`openmem_search` 的工具调用由后续 Task 8 复验单独证明。

真实厂商回调继续以 [本地 Gateway、Sidecar 与回调夹具复验](2026-10-02-local-gateway-sidecar-callbacks.md) 的本机夹具结果为准。没有厂商平台实际投递证据。
