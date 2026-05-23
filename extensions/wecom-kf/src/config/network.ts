import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomConfig, WecomNetworkConfig } from "../types/index.js";
import { getWecomKfChannelBlock } from "./channel-block.js";

export function resolveWecomEgressProxyUrlFromNetwork(network?: WecomNetworkConfig): string | undefined {
  const proxyUrl = network?.egressProxyUrl ??
    process.env.OPENCLAW_WECOM_EGRESS_PROXY_URL ??
    process.env.WECOM_EGRESS_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.ALL_PROXY ??
    process.env.HTTP_PROXY ??
    "";
    
  return proxyUrl.trim() || undefined;
}

export function resolveWecomEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  const wecom = getWecomKfChannelBlock(cfg) as WecomConfig | undefined;
  return resolveWecomEgressProxyUrlFromNetwork(wecom?.network);
}
