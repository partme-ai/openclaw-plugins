# U3 本地 Control UI 浏览器交互核查

日期：2026-10-02。对应[稳定版升级规格 U3](../specs/2026-09-29-openclaw-2026-9-6-upgrade.md)与[实施计划 Task 3](../plans/2026-09-29-openclaw-2026-9-6-upgrade.md)。本记录补充真实浏览器入口与视觉观察；路由鉴权、Cookie 过期和重放无副作用的正式证据仍见[U3 授权记录](2026-10-02-u3-browser-grants.md)。

## 本机运行与结果

使用本机已安装的 OpenClaw 2026.9.6 和 Google Chrome，随机回环端口、一次性 Gateway profile。Router 与 Tracing 从本地 `dist` 加载；为使全新 Control UI 越过模型设置引导，仅配置不发起推理的本地合成模型。没有触碰个人 Gateway 18789，也没有使用厂商账号或生产数据。

| 视口 | Router status | Tracing status |
| --- | --- | --- |
| Mobile 390×884 | tab 点击、iframe HTTP 200、Router 状态 JSON `ok: true` | tab 点击、iframe HTTP 200、Tracing 状态 JSON `ok: true` |
| Tablet 768×1024 | 同上 | 同上 |
| Desktop 1280×1024 | 同上 | 同上 |

六次交互均通过。脱敏报告与六张截图保存在本机忽略目录 `node_modules/.cache/u3-control-ui-browser/2026-10-02T14-13-45.568Z/`，其中 `report.json` 为 `PASS`。人工抽看的手机 Router、平板 Tracing 和桌面 Router 截图均为浏览器原生 JSON 视图。手机端文字拥挤且存在横向截断，桌面端缺乏状态信息布局；**入口和状态读取可用，视觉可用性未通过验收**。三个 Web 通道此前使用的 `test-web/` 是协议夹具页面，不能作为这些插件的产品页面证据。

## 证据边界与交付决定

这次加载本地 `dist`，未在通过的那轮记录源码或产物摘要，也没有重新安装 tarball；因此本报告不单独证明当前源码候选物的浏览器结果。tarball 安装态结果仍以[升级验收记录](2026-09-29-openclaw-2026-9-6-verification.md)和[当前候选物复验](2026-10-02-openmem-installed-tool-e2e.md)为准。本机浏览器结果不证明受保护预发代理、厂商真实回调、跨主机存储或生产部署。

初版一次性浏览器脚本曾因旧 `dist` 可造成假通过、SIGINT 后未写报告且遗留临时状态目录而撤回。该轮测试自己留下的临时目录和专属 Gateway/Chrome 已清理，原有三份 `.browser-*.log` 修改未触碰。

## 可重复本地门禁补测

后续新增 `scripts/u3-control-ui-browser-e2e.mjs`，可在本仓库执行 `node scripts/u3-control-ui-browser-e2e.mjs`。脚本先从当前源码构建 Router/Tracing，报告记录两插件的源码与构建产物 SHA-256；然后在随机回环端口启动 OpenClaw 2026.9.6 隔离 Gateway，使用真实 Chrome 对三种视口下的两个状态 tab 逐次点击，检查 iframe 文档 HTTP 200、同源目标路由和 `ok: true` 的 JSON。报告、截图位于 gitignored 的 `node_modules/.cache/u3-control-ui-browser/`，目录为 0700、报告为 0600；令牌存于一次性配置，通过浏览器 URL fragment 传递，加载后从地址栏移除，并在错误文本中脱敏。

| 本地运行 | 实测结果 | 忽略目录报告 |
| --- | --- | --- |
| 最终源码正常运行 | 退出 0；3 视口×2 tab，6/6 PASS；Chrome、Gateway 与临时状态均清理 | `2026-10-02T14-56-22.836Z/report.json` |
| Gateway 启动后待就绪时 SIGINT | 退出 130；`INTERRUPTED`，三项清理均通过 | `2026-10-02T14-52-19.016Z/report.json` |
| Chrome 创建前 SIGTERM | 退出 143；`INTERRUPTED`，三项清理均通过 | `2026-10-02T14-52-33.982Z/report.json` |
| 手机 Router 截图后 SIGINT | 退出 130；`INTERRUPTED`，三项清理均通过 | `2026-10-02T14-53-17.994Z/report.json` |
| Chrome 不可执行故障注入 | 退出 1；`FAIL`，三项清理均通过，未把启动失败误报为通过 | `2026-10-02T14-55-17.140Z/report.json` |

`node --check scripts/u3-control-ui-browser-e2e.mjs` 通过；最终版本在 Chrome 启动故障注入后重新完整运行，独立复审为 **Spec PASS / Quality APPROVE**。现场构建消除了旧 `dist` 假通过，启动及页面运行阶段的中断注入验证了报告和清理。当前无该脚本的专属临时目录或 Gateway/Chrome 进程。

新门禁证明本地源码构建后的入口与状态内容可重复读取；它仍不安装 tarball，不验证真实代理、厂商回调或生产部署，也不把浏览器原生 JSON 视图判为视觉可用。若需要可维护的状态页面，应在新的增量规格中明确 Router/Tracing 的页面内容、移动端可读性与错误状态。当前 U3 的鉴权要求不依赖视觉页面完成。
