# OpenClaw 2026.9.6 安装态验收记录

日期：2026-10-02。对应[稳定版升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)和[实施计划](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md)。状态：**27/27 当前安装态场景通过**；U3 的 Router/Tracing 同插件浏览器 grant 正例仍待验证。本记录证明固定宿主上的本地闭环，不是生产发布批准。

## 执行环境与门禁

- 隔离工作树：`openclaw-plugins/.worktrees/openclaw-stable-upgrade`；安装路径：`~/.openclaw-queue-e2e/extensions/`。真实启动 OpenClaw `2026.9.6`，Node `v24.18.0`，CLI 来自工作树锁定的 OpenClaw npm 包。
- 最终版本重新执行 `pnpm typecheck`、`pnpm build`、`pnpm test:unit`，全部退出 0；Memory 43/43、OpenMem 46/46、message-sdk 519/519。其他包有 9 个依赖真实服务的单测跳过，分别由安装态场景补证。`pnpm test:e2e:harness` 29/29、`pnpm test:release-scripts` 27/27、`pnpm check-release-readiness`、`pnpm check-explanatory-assets`、`pnpm check-package-archives`（28 包）、`node scripts/check-openclaw-baseline.mjs`、`git diff --check` 均退出 0。
- 每个场景打包当前候选 tarball，在隔离 profile 安装并启动 Gateway；报告记录真实宿主、插件版本、tarball SHA-256、当前源码与 E2E 输入指纹。没有使用 `skip-install` 或 `skip-browser`，27 项 skipCount 均为 0。浏览器三项由本机 Chrome 完成实际页面交互。
- `node scripts/check-e2e-evidence.mjs` 最终退出 0：`E2E evidence is current for 27 runtime plugins (OpenClaw 2026.9.6).`
- Router/Gotify 首次重跑在启动前遇到 `18080` 被工作区外容器占用；保留该容器，使用 `E2E_GOTIFY_PORT=18081` 与匹配的 `GOTIFY_URL` 重跑，通过并纳入下表。
- U3 另有真实 Gateway 签发的只读 Cookie 测试：[归档](../../../scripts/fixtures/u3-auth-grant/reports/2026-10-01T21-04-51.438Z-pass.json)。它覆盖同插件 GET、POST 拒绝、跨插件 Router 拒绝及真实五分钟失效；不等同于 Router/Tracing 自身签发的浏览器 grant 正例。

## 27 插件逐项证据

| 插件 | 安装态结果 | 插件版本 | tarball SHA-256 | 源码与 E2E 指纹 | 归档 |
| --- | --- | --- | --- | --- | --- |
| mqtt | PASS | 2026.7.1 | `a207f18b4e0429d718a71073e4e0057959bce5b846b8dc8cc391bca5a519e850` | `be941f4511bdf423ad95fac0b4c30e9f06bc6fc8b604e08f610387c950cdbd5f` | [归档](../../../scripts/e2e/reports/2026-10-02T01-26-31.620Z-tracing+mqtt-40304668-8848-40cc-aef8-f1963d7551b3.json) |
| stomp | PASS | 2026.7.1 | `222ddec109b8b00d254ade8a7af3e6ffb6a2a129497e42d609fb12dfcca1c492` | `eb7b7c04a816d54d9ab3ac11c3e5fcc17f4cf5ed938f7d34accb494e719811b6` | [归档](../../../scripts/e2e/reports/2026-10-02T01-31-15.855Z-stomp-1fa499c2-f6d6-4c7b-bc1e-0c5c84c9479e.json) |
| web-mqtt | PASS | 2026.7.1 | `16e8971b417b4b6f7e7ed50737361cdeb3c486f6999a3e0826c0c5c174690f74` | `d2829aa0c19a442149f6846a20ba04567a17edba10a8713c49a6fd011a1f7c76` | [归档](../../../scripts/e2e/reports/2026-10-02T01-32-16.054Z-web-mqtt-340327d4-2e1f-4cd6-ad96-78a7a7900bb1.json) |
| web-stomp | PASS | 2026.7.1 | `1433818f42e012012c48eb1852d3f3c58053e24792cddc223669e8c8f1834221` | `f1c80c87c90e3c51e8a856a51766d8a2c504cdf19211cda9b9a27a281084369f` | [归档](../../../scripts/e2e/reports/2026-10-02T01-33-20.956Z-web-stomp-101b809f-b5af-4452-8f04-e524f805b81e.json) |
| web-socket | PASS | 2026.7.1 | `3f3b620273016f7f8a715e1827992e7005ec72cbbec82235d9bfb65d27e9a94c` | `2d5bd2c43761ac3ca53b74d6cb408468bac7b3fbb7f8614890da7823f3487af3` | [归档](../../../scripts/e2e/reports/2026-10-02T01-34-12.858Z-web-socket-978a0915-8f0d-4421-938a-c0aca1a68d62.json) |
| rabbitmq | PASS | 2026.7.1 | `ae6ac893087fc20de9131ca45e62f2b94a9d87f86df512f520bef8a6cd042ace` | `10b350f35890cb8f2088a3861516d89700a4388e8a469c3b6c1483e0cd6d8658` | [归档](../../../scripts/e2e/reports/2026-10-02T01-35-14.068Z-rabbitmq-c15fe31c-42ac-4787-b219-39c9b5322b51.json) |
| rocketmq | PASS | 2026.7.1 | `a8f206d2f57da141d7f5f6307a3e0c56c39890e745f6162fbfb6d5e8cdf39f3f` | `ea2b938a9b7cc376e8cc76bf0bd97b1adc9ceed7d40e52678000204d73b3ecdf` | [归档](../../../scripts/e2e/reports/2026-10-02T01-36-54.417Z-rocketmq-8c129134-360f-49a0-acd3-908d60c2d03f.json) |
| gotify | PASS | 2026.7.1 | `7562dc91704544bb9f2a1c60668dc15ef6ab1d308b892e51bcdc2183f4408fdf` | `d788f45353543a81e8429050e1dc6839e301fdaf251a42f28cea4ebe5b3fe4c0` | [归档](../../../scripts/e2e/reports/2026-10-02T01-22-37.014Z-router+gotify-5159df71-6b94-4900-a0e5-bb5b5447ffc4.json) |
| redis-stream | PASS | 2026.7.1 | `e6d26038cb4639b059c7987bb5e2cbad26d4db3b9e8662043473036b491207db` | `89db1cd732a2f2c1b282b77d0e027323f7a1f19aadb3255bb036f04f1417b9d5` | [归档](../../../scripts/e2e/reports/2026-10-02T01-38-08.637Z-redis-stream-1ae757b8-2019-456c-83c5-0525458db3da.json) |
| wecom | PASS | 2026.7.1 | `49c5c3a0ebe8daec596fa44f262f1fc00f988e0f215e9df6eb94cca01e000b77` | `c18da69165ebe54c7dd6d367bdacef0d2246014beda2c0da35126b0b1140660d` | [归档](../../../scripts/e2e/reports/2026-10-02T01-39-23.447Z-wecom-bba7717e-9d28-450d-a8d6-2e7e28f9a53c.json) |
| wecom-kf | PASS | 2026.7.1 | `16f268518d40ef1371e5082f1181fbebd9b71b98c74b1c4553cac360919894a2` | `364356734d82326ea89ea68aba9e8861425ec3c8f2c09dc3ebe0d42f6b41715f` | [归档](../../../scripts/e2e/reports/2026-10-02T01-40-18.147Z-wecom-kf-37601007-43f4-44c4-80b7-8529d5c4a9c9.json) |
| wechat | PASS | 2026.7.1 | `fbfb43907f37f6877822de7298c481ddbb979ab0d3afb4ed2b5192a75da054d9` | `f39c727458fb00a41864d556e3fb1f408a2d099e1da5cbca4cf0e87ae5be8364` | [归档](../../../scripts/e2e/reports/2026-10-02T01-41-28.384Z-wechat-7ec3416c-bb3b-4b21-9b7c-1e5b4f4e4fb2.json) |
| wechat-ipad | PASS | 2026.7.1 | `4b78582f19af9a35f216cd7c77ec46cd21e9d030f05c7b3a1296c3beebcdb011` | `a36e90483097ab7306bab35f99d2325b1802b962659a040ae4d61b1e655261ca` | [归档](../../../scripts/e2e/reports/2026-10-02T01-42-23.252Z-wechat-ipad-e9735766-9e12-4e87-afd7-9e34bd6ade18.json) |
| douyin | PASS | 2026.7.1 | `161e5f32bda824869df8d40160205c55b297b51ef42b14f8bc31c64301fe9e0b` | `2fbeefbbf274f3ace11723142b7465cc86a71acb555f3f1f6ed155d89ea8c882` | [归档](../../../scripts/e2e/reports/2026-10-02T01-17-34.997Z-douyin-3e8c1335-0926-4e4b-bb54-bb5539db9f30.json) |
| rednode | PASS | 2026.7.1 | `b44b48e6188dc40638f922e99f710b218b57c0bec672c63f388a4ca3e61746bf` | `338ed3c6685d1d57866b44168f7bbef3c35e2d7b8d4127eacc6332db30581da4` | [归档](../../../scripts/e2e/reports/2026-10-02T01-18-17.585Z-rednode-5dc7e574-7cb6-48fe-96cc-c8b1c64aeca8.json) |
| amap | PASS | 2026.7.1 | `b23963ef9ed299ab4142bbd0abb6564e10f4658eb882d3370839aea854cd4dad` | `cfe8d372d9c5576562b116d1ee0f80762693f16a27ae83ffe8148a7bcc2b1352` | [归档](../../../scripts/e2e/reports/2026-10-02T01-19-00.330Z-amap-14c002d9-56c2-479e-a8f5-30ccb903674e.json) |
| meituan | PASS | 2026.7.1 | `dd6029ad4018b346a381931adc061d2927245487b32fc6bc63a8abea442d4b33` | `fe4d4a1ee9ab339fdc9a86439100ada35c2a15abdfcbbda1c785359ab067eabd` | [归档](../../../scripts/e2e/reports/2026-10-02T01-19-44.401Z-meituan-a8a824cd-cb25-4bc2-8db9-b709d7c347b8.json) |
| bridge | PASS | 2026.7.1 | `3dcafb5d43109089f1e0d01a9c81781b68cf5e3c968e4a38fd338f9431bf3fe6` | `933975bcc40dffaebc135742e95a4c0b547b1c679d05ddbcf4e4248dabf68d65` | [归档](../../../scripts/e2e/reports/2026-10-02T01-21-06.393Z-bridge+mqtt-febe5824-46f4-4a77-bd7f-2cdb0311a993.json) |
| router | PASS | 2026.7.1 | `eea1389a68509d68659ac6f64df7d51679f4af49f2ab1533438bfe446c7478c3` | `09b0271ce25ec2ff0e1ef3b7e5599a48985294e0f91c67cd22e2c194d621673d` | [归档](../../../scripts/e2e/reports/2026-10-02T01-22-37.014Z-router+gotify-5159df71-6b94-4900-a0e5-bb5b5447ffc4.json) |
| nacos | PASS | 2026.7.1 | `1d20636382b5b0ac8619a2f963da826524d4c54114e49d2974121bfa39332c16` | `c273dd73692505404f1128f144c56e38ea08b11b0855b76428ca7334112ea153` | [归档](../../../scripts/e2e/reports/2026-10-02T01-23-44.421Z-nacos-fbfa8073-efde-4508-b68b-49c176077464.json) |
| mtls | PASS | 2026.7.1 | `0fa81c82f129b88023506ea4a75c6c603fdb6725791837b34aca6368c2c8d753` | `6c20c21de9e3ec10e0698e636e67c7e47688684ce66d693064a661e349f07e6b` | [归档](../../../scripts/e2e/reports/2026-10-02T01-24-27.593Z-mtls-ce6db4ee-b05d-42ac-8dfd-77f0713decf0.json) |
| oauth2 | PASS | 2026.7.1 | `ce0f4ec551e0ab7f17a0ace2893f9c21a9c8e56d97fab99086d817ac37037c19` | `3e3601f2ca5d5906e49c517537c5f994015e8836a04645ada4fea8c6b48fe49e` | [归档](../../../scripts/e2e/reports/2026-10-02T01-25-09.815Z-oauth2-7b25f9d8-0dca-414b-abad-064905f33463.json) |
| tracing | PASS | 2026.7.1 | `8a3a0bb51809e0654fceffcc304517c3ef120e573fa7621f13317aad1febd339` | `c6429e87840c58eab80fab3ee0d3c6abb95c298fe8a3da58a3ba038b0b1dcd67` | [归档](../../../scripts/e2e/reports/2026-10-02T01-26-31.620Z-tracing+mqtt-40304668-8848-40cc-aef8-f1963d7551b3.json) |
| prometheus | PASS | 2026.7.1 | `9b71aa17669245cee78ac71fa6671c5a93ac1d7cb70b99df08145072b2cbcdc3` | `377766d9edbd830116f582bd54ee43bb4e03456dcf0b08ee6b144ce9085facec` | [归档](../../../scripts/e2e/reports/2026-10-02T01-27-30.457Z-prometheus-04033b44-ec8a-47d6-a00b-f8e37cd840ed.json) |
| knowledge | PASS | 2026.7.1 | `68acc0346269addb1c450eaecf44f51af8e757c0774fba43d7f343c9d492ce1e` | `a198c69bbfa12d9abda0d1705caa058df45c7f2d9d00bf93f33c5652c7987f22` | [归档](../../../scripts/e2e/reports/2026-10-02T01-28-33.049Z-knowledge-eec51cb0-c27a-4260-aeb2-6103dcf28344.json) |
| memory | PASS | 2026.7.1 | `f0fc916cfef038e9baf94b404ec380f45a6efc4f4758ee2008a6acde7e09ba95` | `c79349d3e5f53c743f4d0cd0ee5f558b9119ab3987a39c5dc1f023f3995af64b` | [归档](../../../scripts/e2e/reports/2026-10-02T01-29-37.890Z-memory-03242e17-f3a4-465f-b4c4-0d5a3e32cdf6.json) |
| openmem | PASS | 2026.7.1 | `985d45de393164e4ed70b8581ef8bb16e42e8d60d99a66bab047d550f9553752` | `8f7792a67a1f3d24b61f9985ff56c1bf6fb03f2337781823c198e23ffd1ed23d` | [归档](../../../scripts/e2e/reports/2026-10-02T01-30-27.008Z-openmem-8d63af06-5542-4e64-aa89-cf1e4fb49719.json) |

## 修复与可观察功能

- **Memory/OpenMem 根因：** OpenClaw 2026.9.6 的 Agent prepared runtime 使用 `discovery` 注册表；两插件此前在 `full` 模式守卫后才注册 `agent_end`，导致 Gateway 服务存在但 Agent 完成时没有摄取。修复后 Agent 注册表借用 Gateway 已创建的运行时：Memory 复用同一存储、写队列和去重状态，OpenMem 复用同一会话协调器，避免 `session_end` 抢先归档。Memory 的 L2 提取计数也绑定共享运行时。同配置重叠注册、注册失败清理、密钥轮换、停机时在途 Hook、晚到轮次和不确定提交都有回归用例。真实 tarball 分别验证 L0–L3 持久化与重启召回，以及 OpenMem Sidecar 摄取、排空、归档和下一轮连续召回。
- **协议与投递：** MQTT、STOMP、Web MQTT、Web STOMP、WebSocket、RabbitMQ、RocketMQ、Redis Stream、Bridge/MQTT、Router/Gotify 的 Agent 回复、协议确认、去重/重投、浏览器或 Broker 负例在各自归档中通过。RabbitMQ 含同 ID 重投静默窗口和 DLQ/NACK；Redis Stream 验证 PEL 清空；Tracing/MQTT 验证 Collector 同一 Span 与 nonce。
- **业务渠道与工具：** WeCom、WeCom KF、WeChat、WeChat iPad、Douyin、Amap、Meituan、RedNode 均为安装态 fixture。Meituan 覆盖签名通知与消息回调持久 inbox、Agent tool；WeChat 覆盖工作区 PNG 上传和目录逃逸拒绝。
- **能力与安全：** Knowledge 的索引、Embedding HTTP、首次 Agent 注入和 Gateway 重启后 SQLite 检索通过。OAuth2 与 mTLS 的回环代理、宿主 trusted-proxy 鉴权及拒绝用例通过；OAuth2 使用测试 IdP 和 HTTP 客户端。Nacos、Prometheus 的本地服务生命周期和管理接口通过。

## 当前任务状态与边界

- U1、U2、U4、U5、U6、U7、U8 有当前源码、单测及对应安装态证据；U3 的 Gateway bearer 授权读/重放和匿名/伪造拒绝已验证，但 Router/Tracing 自身没有 Control UI tab，尚无同插件浏览器 grant 授权 GET/POST 正例。U3 保持未完成，不把通用夹具推断为这两个插件的完整验收。
- 27/27 PASS 只覆盖固定宿主的 Gateway 安装态与本地 fixture/容器服务。没有真实厂商账号、平台回调、生产流量、生产部署或长期故障演练证据；直接本地 Agent 模式未做同等验证。不能据此宣称所有插件生产就绪。
- 独立复核 Memory/OpenMem 的注册重叠、生命周期、提交意图与 Sidecar 写入顺序后，未发现新的 Critical/Important 代码问题；下述 Sidecar 协议阻断仍需独立变更和真实故障恢复验收。
- OpenMem Sidecar 使用 `OPENMEM_E2E_REPO=/Users/wandl/workspaces/workspace-agent-fabric/OpenMem` 指向本地仓库；其依赖已安装且构建通过。旧 2026.7.1 E2E 计划仍保留原状态，当前 2026.9.6 证据不静默关闭它。

### OpenMem 提交结果不明时的对账边界

OpenMem 插件在非幂等 `commit` 前，通过 Sidecar 的持久 `eventId` 去重写入确定性提交意图。结果不明时，新旧 Gateway 运行时都不会自动重放同一提交；只有会话状态为 `ARCHIVED`，且 `/archives` 中存在对应会话的文档、文档每项 fact 均有对应 `/externalized-memories` 记录时，才确认归档完成。日志中的 `sessionId` 和 `intentId` 是对账定位依据。值班人员应先核对 Sidecar 会话、意图事件、归档文档和事实记忆，再确认是否仍有在途提交；插件不会替值班人员猜测结果并再次发送 POST。

**生产阻断：**提交意图持久化后、提交 POST 发出前若进程中断，当前 Sidecar 协议没有可恢复的操作状态或幂等提交接口，ACTIVE 会话可能保持待人工对账。直接本地 Agent 模式、真实厂商回调和生产部署也尚未验收。因此本次 27/27 安装态通过不代表 OpenMem 或全套插件已获生产就绪批准。Sidecar 需要补充原子/幂等提交与可恢复状态后，才能关闭这一阻断。
