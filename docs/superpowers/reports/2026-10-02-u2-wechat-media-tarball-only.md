# U2 微信媒体授权与候选包安装阶段报告

对应[稳定版升级规格 U2](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)与[实施计划 Task 2](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md)。本记录补充[U2 公开 SDK 契约验收](2026-09-29-u2-sdk-compat.md)中的真实 Agent 媒体自动回复缺口。测试日期：2026-10-02（归档时间戳使用 UTC）。

## 失败根因与修复

1. 原 E2E 只证明微信文本自动回复及 SDK 媒体路径守卫单测；未证明宿主处理 Agent 生成的 `MEDIA:`。使用本地 iLink、CDN 和模型 fixture 后，允许的 workspace PNG 可上传，但相邻的 `state/wechat-media/sibling/secret.png` 也被上传并发送 IMAGE。失败归档：`scripts/e2e/reports/2026-10-01T16-39-20.040Z-wechat-7e4c87a1-f276-4f78-8b88-7ba9f17bc273.json`。
2. 微信原先在 `processOneMessage` 仅传 `cfg.tools.fs.workspaceOnly=true` 的浅拷贝。宿主 OpenClaw 2026.9.6 的 `dispatch-from-config-Cu599NRF.mjs` 在约 3309 行优先构造 `state.preparedReplyDispatchRuntime.config`，约 1495 行在没有 `configOverride` 时让 `getReplyFromConfig` 以 `undefined` 配置参数运行。Agent 回复解析因此仍用原配置，把兄弟路径图片复制进宿主管理的 `state/media/outbound`；后续微信守卫只看到了缓存路径。直接调用宿主 `createReplyMediaSourcePreparer` 复证：原配置会缓存兄弟路径；`workspaceOnly=true` 配置返回 `delivery-failed`。
3. 微信当次 `dispatchReplyFromConfig` 现在同时传入原有受限 `cfg` 和公开契约的 `configOverride: { tools: { fs: { workspaceOnly: true } } }`。后者合并到当前 Agent runtime 配置，前者限制宿主后续媒体归一化；不改全局配置。微信账号配置的 `mediaLocalRoots` 仍供直接 channel 出站使用，不能扩大 Agent 自动回复的源路径授权。
4. E2E 安装器原有 `overlayWorkspaceBuild` 在解包 tarball 后用工作区 `dist` 覆盖候选。它来自 2026-05-24 的 `3bb0855`；当前包已含 `dist`，Nacos `tsup` 也构建 `setup-entry`。移除覆盖后，安装内容只来自打包候选；保留解包后的 `packedContentDigest`、安装生产依赖后的复核和精确 consent 摘要门禁。另按独立审查结论将 Tracing 的隔离 E2E 摘要窄更新为 `43cfd365515cc84e64cab55b72e4d0724ac759b10d4c681196d580128a534d17`，其 `{distributedTracing:true}` 能力未变；此项不表示 U3 已验收。
5. 独立审查指出负例原先只比较全局 `message processed` 日志计数，可能被其他消息抢先满足。现为逃逸消息生成唯一 `message_id`，等待模型完成且微信持久 `processed-message` 日志出现该精确 ID 后，才断言零上传请求、零上传、零 IMAGE 和零路径文本泄露。微信在 `processOneMessage` 返回后写入该记录，因此等待覆盖本条消息处理结束。该变更仅影响 E2E 断言时序，不修改微信发布包。

## 红绿与候选核对

| 验证 | 红灯 | 绿灯 |
| --- | --- | --- |
| `node --test scripts/e2e/lib/install.test.mjs` | 工作区 `dist` 与 tarball 不同时，旧覆盖使候选摘要变化并报错 | 3/3 通过；归档字节与安装前内容一致，额外工作区 `setup-entry.js` 未混入 |
| `pnpm --dir extensions/wechat exec vitest run test/media/path-guard.test.ts test/messaging/process-message.test.ts` | dispatch 缺少 `configOverride` 的断言失败 | 9/9 通过 |
| `pnpm --dir extensions/wechat typecheck` | — | 通过 |
| `node --test scripts/e2e/plugins/wechat.test.mjs` | 新等待函数缺失时测试失败 | 1/1 通过；其他消息 ID 与模型完成不能提前满足条件 |
| `node scripts/e2e/run-e2e.mjs --plugins wechat` | 此前 `cfg` 限制单独传递时兄弟根图片被上传，归档 `2026-10-01T17-11-57.482Z-wechat-f547e395-f429-4edc-b37a-23090fc15efa.json` | 正式归档 PASS，见下节 |

最终微信候选 manifest `id=wechat`、`channels=[openclaw-weixin]`、无额外声明能力；包名 `@partme.ai/weixin`，`dist` 有 17 个文件，含 `configOverride` 修复。完整 tarball SHA-256：`fbfb43907f37f6877822de7298c481ddbb979ab0d3afb4ed2b5192a75da054d9`；`reviewedArtifactDigest`（排除安装产生的 `node_modules` 和 `package-lock.json` 后逐文件哈希）：`f4f14b36610a9bc4fadd7c99e9b3c04cc6a2a29e2ac734074e889cb2128fe6d4`。隔离 consent 只接受此内容摘要与上述 manifest 能力。最新候选清单：`scripts/e2e/reports/candidates/da790466-56c6-4c6f-8757-15d6b3162e04.json`。

## 安装态结果与边界

正式执行 `node scripts/e2e/run-e2e.mjs --plugins wechat`，宿主 OpenClaw `2026.9.6`、Node `v24.18.0`；微信包单测 32 文件、384/384 通过；[最新正式 E2E 归档](../../../scripts/e2e/reports/2026-10-01T18-08-32.423Z-wechat-a7b98dd2-b9cf-4f6e-8ae1-dcf463e9de19.json)为 `PASS`，`skipInstall=false`、`skipBrowser=false`、`skipCount=0`。本地 fixture 验证了文本回复、允许 workspace PNG 的 CDN 上传字节/MD5 与 IMAGE 回复、兄弟根 PNG 的零上传请求/零上传/零 IMAGE/零路径文本泄露，以及 Gateway 重启后重复消息去重。运行前、报告中及运行后微信 source fingerprint 均为 `1547a8aca4a486a3aaab6dae683c726f547a220f86a1d15b794fe7edde707cdc`。进程退出后 Docker Compose 已停止，测试 Gateway 和 fixture 端口 19789、19095、19091 无监听。

兼容影响：微信 Agent 当次运行的 `tools.fs.workspaceOnly=true` 会限制其文件工具和自动媒体回复读取 workspace 外文件；其他渠道及用户全局配置不受修改。测试使用本地安全 fixture，尚未覆盖真实微信账号、公网 CDN 或生产部署。后续任何微信源码、SDK、构建产物或安装器变更都需重新计算完整候选和 consent 摘要，再重跑正式归档与证据门禁。此阶段未勾选计划、提交或推送。
