import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

/**
 * 只读配置助手。本插件刻意不提供自动启用向导：非官方协议的合规与封号风险必须由
 * 运维人员阅读文档后显式确认，配置向导不能代替人员接受风险。
 */
export function getWechatIpadChannelSection(cfg: OpenClawConfig): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown> | undefined)?.["wechat-ipad"] ?? {}) as Record<
    string,
    unknown
  >;
}
