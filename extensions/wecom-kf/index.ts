import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, ensureConfigHelpers } from "./src/compat/plugin-sdk-shim.js";

import { createKfCallbackHandler } from "./src/webhook/callback.js";
import { setWecomRuntime } from "./src/runtime.js";
import { wecomPlugin } from "./src/channel.js";
import { createWeComMcpTool } from "./src/mcp/index.js";
import { createKfAccountConfigGetter } from "./src/config/kf-callback.js";
import {
  collectWecomKfRoutePaths,
  isIcsEnabled,
  isLegacyWecomCsEnabled,
} from "./src/config/kf-routes.js";
import { WEBHOOK_PATHS } from "./src/types/constants.js";
import type { WecomKfConfig } from "./src/types/config.js";

// ── KF 智能化（dialogue state → before_prompt_build） ──
import { registerIntelligenceHooks } from "./src/intelligence/hooks.js";

// ── KF Control Tools（核心；API 响应不进 LLM 上下文） ──
import {
  createWecomKfListServicersTool,
  createWecomKfListAccountsTool,
  createWecomKfGetAccountLinkTool,
  createWecomKfTransferSessionTool,
} from "./src/kf/control-tools.js";

// ── ICS 可选运营模块（仅 icsEnabled=true 时 lazy 注册；见 src/ics/） ──
import { registerIcsHttpRoutes } from "./src/ics/register.js";

const plugin = {
  id: "wecom-kf",
  name: "WeCom KF",
  description: "OpenClaw WeCom KF (WeChat Work Customer Service) — KF callback + Control Tools; ICS/agents/skills optional",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    void ensureConfigHelpers();

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
    const kfChannelConfig = initialCfg?.channels?.["wecom-kf"] as WecomKfConfig | undefined;
    for (const path of collectWecomKfRoutePaths(kfChannelConfig)) {
      api.registerHttpRoute({
        path,
        handler: handleKfWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    // Legacy wecom-cs Bot / Agent 回调（默认不注册；lazy load legacy/monitor）
    if (isLegacyWecomCsEnabled(initialCfg)) {
      let legacyWebhookHandler: typeof import("./src/legacy/monitor.js").handleWecomWebhookRequest | undefined;
      const resolveLegacyWebhookHandler = async () => {
        if (!legacyWebhookHandler) {
          const mod = await import("./src/legacy/monitor.js");
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

    // State-aware dialogue prompt injection moved to src/intelligence/hooks.ts (registerIntelligenceHooks)

    // MEDIA instruction prompt injection (for all wecom-kf channel sessions)
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.channelId !== "wecom-kf") return;
      return {
        systemPrompt: [
          "【发送文件/图片/视频/语音】",
          "当你需要向用户发送文件、图片、视频或语音时，必须在回复中单独一行使用 MEDIA: 指令，后面跟文件的本地路径。",
          "格式：MEDIA: /文件的绝对路径",
          "文件优先存放到 ~/.openclaw 目录下，确保路径可访问。",
          "示例：",
          "  MEDIA: ~/.openclaw/output.png",
          "  MEDIA: ~/.openclaw/report.pdf",
          "系统会自动识别文件类型并发送给用户。",
          "",
          "注意事项：",
          "- MEDIA: 必须在行首，后面紧跟文件路径（不是 URL）",
          "- 如果路径中包含空格，可以用反引号包裹：MEDIA: `/path/to/my file.png`",
          "- 每个文件单独一行 MEDIA: 指令",
          "- 可以在 MEDIA: 指令前后附带文字说明",
          "",
          "【文件大小限制】",
          "- 图片不超过 10MB，视频不超过 10MB，语音不超过 2MB（仅支持 AMR 格式），文件不超过 20MB",
          "- 语音消息仅支持 AMR 格式（.amr），如需发送语音请确保文件为 AMR 格式",
          "- 超过大小限制的图片/视频/语音会被自动转为文件格式发送",
          "- 如果文件超过 20MB，将无法发送，请提前告知用户并尝试缩减文件大小",
        ].join("\n"),
      };
    });
  },
};

export default plugin;
