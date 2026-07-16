import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getWechatIpadChannelSection } from "./channel-setup-factory.js";

/**
 * Setup remains manual by design: a generic wizard must not accept the
 * unofficial-protocol risk on behalf of an operator.
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
