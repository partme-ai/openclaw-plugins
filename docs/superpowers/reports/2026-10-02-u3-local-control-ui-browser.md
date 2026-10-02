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

测试时曾编写一次性浏览器脚本。独立审查确认六次导航与内容断言有效，但指出旧 `dist` 可能造成假通过以及单独中断 runner 的清理风险；现场构建修复后，SIGINT 注入仍出现退出码 130 而未写报告、遗留临时状态目录。因此**脚本未纳入仓库**，不能宣称当前已有可重复的浏览器视觉验收门禁。测试自己留下的临时目录和专属 Gateway/Chrome 已清理，原有三份 `.browser-*.log` 修改未触碰。

后续若要求可维护的状态页面，应在新的增量规格中明确 Router/Tracing 的页面内容、移动端可读性与错误状态；重做浏览器门禁时需同时覆盖现场构建绑定和信号清理。当前 U3 的鉴权要求不依赖视觉页面完成。
