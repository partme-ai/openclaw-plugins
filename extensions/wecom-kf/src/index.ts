import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { createKfCallbackHandler } from "./webhook/callback.js";
import { setWecomRuntime } from "./runtime/index.js";
import { wecomPlugin } from "./channel/channel.js";
import { createWeComMcpTool } from "./mcp/index.js";
import { createKfAccountConfigGetter } from "./config/kf-callback.js";
import {
  collectWecomKfRoutePaths,
  getWecomKfChannelBlock,
  isIcsEnabled,
  isLegacyWecomCsEnabled,
} from "./config/kf-routes.js";
import { WEBHOOK_PATHS } from "./types/constants.js";
import type { WecomKfConfig } from "./types/config.js";

// ── KF 智能化（dialogue state → before_prompt_build） ──
import { registerIntelligenceHooks } from "./intelligence/hooks.js";
import { initKfSendGuardStore } from "./agent/kf-send-guard.js";
import { registerWecomKfMediaPrompt } from "./agent/media-prompt.js";

// ── KF Control Tools（核心；API 响应不进 LLM 上下文） ──
import {
  createWecomKfListServicersTool,
  createWecomKfListAccountsTool,
  createWecomKfGetAccountLinkTool,
  createWecomKfTransferSessionTool,
} from "./tools/control-tools.js";

// ── ICS 可选运营模块（仅 icsEnabled=true 时 lazy 注册；见 src/ics/） ──
import { registerIcsHttpRoutes } from "./http/ics/register.js";

const plugin = {
  id: "wecom-kf",
  name: "WeCom KF",
  description: "OpenClaw WeCom KF (WeChat Work Customer Service) — KF callback + Control Tools; ICS/agents/skills optional",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
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

    // ── KF 核心：客服回调（主路径） ──
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

    // Legacy Bot / Agent 回调（默认不注册；lazy load legacy/monitor）
    if (isLegacyWecomCsEnabled(initialCfg)) {
      let legacyWebhookHandler: typeof import("./legacy/monitor.js").handleWecomWebhookRequest | undefined;
      const resolveLegacyWebhookHandler = async () => {
        if (!legacyWebhookHandler) {
          const mod = await import("./legacy/monitor.js");
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

    // ── ICS 可选运营 REST API（默认关闭；agents/、skills/ 不在此 import 链） ──
    if (isIcsEnabled(initialCfg)) {
      registerIcsHttpRoutes(api);
    }

    registerIntelligenceHooks(api);
    registerWecomKfMediaPrompt(api);

    // Register wecom_kf_mcp
    api.registerTool(createWeComMcpTool(), { name: "wecom_kf_mcp" });

    // ── KF Control Tools（wecom_kf_*；旧 kf/tools.ts 已 deprecated，不再注册） ──
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
  },
};

export default plugin;

export * from "./types/index.js";
