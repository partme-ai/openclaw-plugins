/**
 * @module wecom-kf/index
 *
 * 企业微信 **客服（KF）** OpenClaw 插件轻量入口。
 *
 * **职责**：
 * - 导出 plugin 元数据（id / configSchema / register）
 * - 完整能力由 `runtime/register-full.ts` 在 full 模式注册（Channel、Webhook、Tools、Hooks）
 *
 * **关键导出**：默认 plugin、`types/index` 重导出
 */

import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { registerWecomKfFull } from "./runtime/register-full.js";

const plugin = {
  id: "wecom-kf",
  name: "WeCom KF",
  description:
    "OpenClaw WeCom KF (WeChat Work Customer Service) — KF callback + Control Tools; agents/skills optional",
  configSchema: emptyPluginConfigSchema(),
  register: registerWecomKfFull,
};

export default plugin;

export * from "./types/index.js";
