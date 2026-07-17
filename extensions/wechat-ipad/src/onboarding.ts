import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getWechatIpadChannelSection } from "./channel-setup-factory.js";

/**
 * Setup remains manual by design: a generic wizard must not accept the
 * unofficial-protocol risk on behalf of an operator.
 *
 * 中文说明：只有 `enabled` 与风险确认开关同时为 true 才报告“已配置”；该函数不写
 * 配置，也不替使用方启动外部 iPad 协议服务。
 */
export function describeWechatIpadManualSetup(cfg: OpenClawConfig): {
  configured: boolean;
  message: string;
} {
  const section = getWechatIpadChannelSection(cfg);
  const configured =
    section.enabled === true && section.acknowledgeUnofficialProtocolRisk === true;
  return {
    configured,
    message: configured
      ? "External bridge is explicitly enabled."
      : "Review README.md, then manually set enabled and acknowledgeUnofficialProtocolRisk.",
  };
}
