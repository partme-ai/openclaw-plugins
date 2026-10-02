# OpenClaw 2026.9.6 当前候选物复验

日期：2026-10-02。对应[升级规格](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)的 U8，以及 [U3 同插件授权](2026-10-02-u3-browser-grants.md)和 [U9 OpenMem 可恢复提交](2026-10-02-openmem-recoverable-commit.md)后续变更。

## 本地安装态结果

- 宿主：OpenClaw 2026.9.6、Node v24.18.0。27 个运行时插件均从当前候选 tarball 安装；27 项插件 E2E 结果均为 PASS，`skipCount=0`。`node scripts/check-e2e-evidence.mjs` 退出 0，逐项核对源码指纹、候选包 SHA-256、安装包版本及运行结果。报告和候选包保存在 gitignored 的 `scripts/e2e/reports/`。
- 当前覆盖 ID：`mqtt`、`stomp`、`web-mqtt`、`web-stomp`、`web-socket`、`rabbitmq`、`rocketmq`、`gotify`、`redis-stream`、`wecom`、`wecom-kf`、`wechat`、`wechat-ipad`、`douyin`、`rednode`、`amap`、`meituan`、`bridge`、`router`、`nacos`、`mtls`、`oauth2`、`tracing`、`prometheus`、`knowledge`、`memory`、`openmem`。
- Web-MQTT、Web-STOMP、Web-Socket 各有实际 Chrome 浏览器 PASS。证据门禁现在按 `web-browser` 分类强制要求每项恰好一个浏览器 PASS；门禁回归测试 10/10 通过。Bridge 与 MQTT、Router 与 Gotify、Tracing 与 MQTT 按依赖组合执行；mTLS 与 Prometheus 使用宿主 Gateway。
- OpenMem Sidecar 路径边界修改后，使用 `OPENMEM_E2E_REPO=/Users/wandl/workspaces/workspace-agent-fabric/OpenMem` 重跑真实 Sidecar 和 Gateway，最终归档为 `scripts/e2e/reports/2026-10-02T05-26-17.738Z-openmem-9db66d9b-611f-457b-a795-681bdef0299d.json`，安装包 SHA-256 为 `1962e95f939a51910fa7b9ef75ca97ff29a37dbf577814c5fc379f3c69544cd6`。

## 构建与检查

插件仓库 `pnpm typecheck`、`pnpm build`、`pnpm test:unit`、`pnpm test:e2e:harness`、`pnpm test:release-scripts`、`pnpm check-release-readiness`、`pnpm check-explanatory-assets`、`node scripts/check-package-archives.mjs` 均退出 0。Unit 套件中存在原有跳过项，因此不以其退出码代替每项功能验收。OpenMem `pnpm -r run test` 为 Core 16/16、Server 7/7；`pnpm -r run build` 退出 0。OpenMem 仓库声明 pnpm 10.32.1，而本机为 9.0.0，根 `pnpm test` 被版本门禁拒绝；未安装或升级工具。

## 证据边界

这些结果证明当前源码、已安装包、本地 Gateway、Sidecar 和测试服务的闭环。厂商真实回调、受保护网络中的长期运行、OpenMem 多写入者与断电恢复、实际浏览器界面交互以及生产部署尚未验收；不得据此宣称全套插件已在生产环境就绪。
