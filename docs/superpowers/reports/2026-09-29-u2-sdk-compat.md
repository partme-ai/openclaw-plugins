# U2 公开 SDK 契约验收记录

日期：2026-09-29。对应[稳定版升级规格 U2](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)与[实施计划 Task 2](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md)。

## 实施与验证

- 迁移提交 `8afac18` 已将已删除的公开 SDK 路径迁移到 2026.9.6 可用子路径。当前补充 `importOpenClawPluginSdk` 的非测试环境失败告警；可选加载仍返回 `null`，同一路径只告警一次。新增测试先红后绿。
- `node --test scripts/e2e/lib/sdk-load-probe.test.mjs`：4/4 通过；`pnpm --dir extensions/message-sdk test`：64 文件、470/470 通过。
- `pnpm typecheck`、`pnpm build`：全仓各 30 项通过；`pnpm --dir extensions/message-sdk verify:release`：23 个导出、86 个消费者、12 个 OpenClaw 运行时符号通过；`node scripts/check-package-archives.mjs`：28/28 包通过。
- 隔离 npm 宿主实际安装 OpenClaw 2026.9.6、Node v24.18.0；未设置 `VITEST` 或 `NODE_ENV`。将本轮构建的 28 个 tarball 安装后，逐个加载实际入口，28/28 通过，包含 Nacos `./dist/bootstrap.cjs`。逐包归档 SHA-256、入口和结果见[探针清单](2026-09-29-u2-final-probe.json)。独立审查重新核对安装版本和归档 SHA-256，并重跑 28/28 入口导入。
- 从迁移前提交 `b72a7d6` 构建的 MQTT 运行时 tarball（SHA-256 `0d5b2ac2926b921e35ebd99a84378ae16c9ef9e5c8ab09554dd8a7adfc48777c`）在同一宿主加载时真实报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，目标是已删除的 `./plugin-sdk/outbound-runtime`。旧版完整构建的 DTS 阶段也因根 SDK 类型导入失败；旧包探针以 ESM 产物验证运行时不兼容。
- 微信媒体路径守卫测试 5/5 通过，覆盖会话根内成功、兄弟会话/外部目录/符号链接逃逸及超大文件拒绝。

## 边界

本记录证明公开导入和最终包入口在隔离宿主可加载。运行时才触发的可选能力由契约检查及加载告警诊断；27 个插件的业务功能和外部平台行为仍按 U8 分别验收。证据清单对应本轮归档，后续源码或包变化须重新生成，不能沿用旧 SHA-256。
