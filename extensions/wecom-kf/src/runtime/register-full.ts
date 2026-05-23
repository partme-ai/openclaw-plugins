/**
 * WeCom KF full 模式注册：Channel、Webhook、Tools、Hooks。
 */

import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

import { initKfSendGuardStore } from "../agent/kf-send-guard.js";
import { registerWecomKfMediaPrompt } from "../agent/media-prompt.js";
import { wecomPlugin } from "../channel/channel.js";
import { createKfAccountConfigGetter } from "../config/kf-callback.js";
import {
  collectWecomKfRoutePaths,
  getWecomKfChannelBlock,
  isIcsEnabled,
  isLegacyWecomCsEnabled,
} from "../config/kf-routes.js";
import { registerIcsHttpRoutes } from "../http/ics/register.js";
import { registerIntelligenceHooks } from "../intelligence/hooks.js";
import { createWeComMcpTool } from "../mcp/index.js";
import { setWecomRuntime } from "../runtime/index.js";
import { WEBHOOK_PATHS } from "../types/constants.js";
import {
  createWecomKfGetAccountLinkTool,
  createWecomKfListAccountsTool,
  createWecomKfListServicersTool,
  createWecomKfTransferSessionTool,
} from "../tools/control-tools.js";
import { createKfCallbackHandler } from "../webhook/callback.js";

/**
 * 注册 WeCom KF 插件完整运行时能力。
 *
 * @param api - OpenClaw 插件宿主 API。
 */
export function registerWecomKfFull(api: OpenClawPluginApi): void {
  void initKfSendGuardStore();

  setWecomRuntime(api.runtime);
  api.registerChannel({ plugin: wecomPlugin });

  const getOpenClawConfig = (): OpenClawConfig | undefined =>
    (api.runtime as { config?: OpenClawConfig }).config;

  const kfCallbackHandler = createKfCallbackHandler(createKfAccountConfigGetter(getOpenClawConfig));
  const handleKfWebhookRequest = async (
    req: Parameters<typeof kfCallbackHandler>[0],
    res: Parameters<typeof kfCallbackHandler>[1],
  ): Promise<boolean> => {
    await kfCallbackHandler(req, res);
    return true;
  };

  const initialCfg = getOpenClawConfig();
  const kfChannelConfig = getWecomKfChannelBlock(initialCfg);
  for (const path of collectWecomKfRoutePaths(kfChannelConfig)) {
    api.registerHttpRoute({
      path,
      handler: handleKfWebhookRequest,
      auth: "plugin",
      match: "prefix",
    });
  }

  if (isLegacyWecomCsEnabled(initialCfg)) {
    let legacyWebhookHandler:
      | typeof import("../legacy/monitor.js").handleWecomWebhookRequest
      | undefined;
    const resolveLegacyWebhookHandler = async () => {
      if (!legacyWebhookHandler) {
        const mod = await import("../legacy/monitor.js");
        legacyWebhookHandler = mod.handleWecomWebhookRequest;
      }
      return legacyWebhookHandler;
    };
    const csRoutes = [
      WEBHOOK_PATHS.BOT_PLUGIN,
      WEBHOOK_PATHS.BOT,
      WEBHOOK_PATHS.BOT_ALT,
      WEBHOOK_PATHS.AGENT_PLUGIN,
      WEBHOOK_PATHS.AGENT,
      WEBHOOK_PATHS.LEGACY_BOT_PLUGIN,
      WEBHOOK_PATHS.LEGACY_BOT,
      WEBHOOK_PATHS.LEGACY_BOT_ALT,
      WEBHOOK_PATHS.LEGACY_AGENT_PLUGIN,
      WEBHOOK_PATHS.LEGACY_AGENT,
    ];
    for (const path of csRoutes) {
      api.registerHttpRoute({
        path,
        handler: async (req, res) => {
          const handleWecomWebhookRequest = await resolveLegacyWebhookHandler();
          return handleWecomWebhookRequest(req, res);
        },
        auth: "plugin",
        match: "prefix",
      });
    }
  }

  if (isIcsEnabled(initialCfg)) {
    registerIcsHttpRoutes(api);
  }

  registerIntelligenceHooks(api);
  registerWecomKfMediaPrompt(api);

  api.registerTool(createWeComMcpTool(), { name: "wecom_kf_mcp" });

  api.registerTool(
    (ctx) => createWecomKfListServicersTool({ ...ctx, config: getOpenClawConfig() }),
    { name: "wecom_kf_list_servicers", optional: true },
  );
  api.registerTool(
    (ctx) => createWecomKfListAccountsTool({ ...ctx, config: getOpenClawConfig() }),
    { name: "wecom_kf_list_accounts", optional: true },
  );
  api.registerTool(
    (ctx) => createWecomKfGetAccountLinkTool({ ...ctx, config: getOpenClawConfig() }),
    { name: "wecom_kf_get_account_link", optional: true },
  );
  api.registerTool(
    (ctx) => createWecomKfTransferSessionTool({ ...ctx, config: getOpenClawConfig() }),
    { name: "wecom_kf_transfer_session", optional: true },
  );
}
