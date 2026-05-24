/**
 * 美团渠道定义模块。
 *
 * **架构角色**：向 OpenClaw 注册 Channel 元数据、多账号 config 解析、
 * setup wizard 与出站适配器。
 *
 * **关键依赖**：`./types`、`./onboarding`、`./outbound`
 */

import type { ChannelDefinition, MeituanAccountConfig } from "./types.js";
import { meituanSetupAdapter, meituanSetupWizard } from "./onboarding.js";
import { meituanSendText } from "./outbound.js";

/** 美团 Channel 单例，供 index / setup-entry 引用 */
export const meituanChannel: ChannelDefinition = {
  id: "meituan",
  meta: {
    id: "meituan",
    label: "美团",
    blurb: "美团开放平台渠道，支持订单/评价/经营数据与自动化运营",
    aliases: ["meituan", "美团"],
  },
  capabilities: {
    chatTypes: ["direct"],
  },
  setupWizard: meituanSetupWizard,
  setup: meituanSetupAdapter,
  config: {
    /** 列出 accounts 子键；无多账号时返回 ["default"] */
    listAccountIds: (cfg) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const meituan = channels?.meituan as Record<string, unknown> | undefined;
      const accounts = meituan?.accounts as Record<string, unknown> | undefined;
      return accounts ? Object.keys(accounts) : ["default"];
    },
    /** 解析单账号配置：accounts.<id> 优先，否则回退顶层 meituan 节 */
    resolveAccount: (cfg, accountId) => {
      const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
      const meituan = channels?.meituan;
      const accounts = meituan?.accounts as Record<string, MeituanAccountConfig> | undefined;
      const id = accountId ?? "default";
      return (
        accounts?.[id] ??
        (meituan as unknown as MeituanAccountConfig) ??
        ({} as MeituanAccountConfig)
      );
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: meituanSendText,
  },
};
