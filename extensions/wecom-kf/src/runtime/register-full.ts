/**
 * WeCom KF full 模式注册：Channel、Webhook、Tools、Hooks。
 */

import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";

import { initKfSendGuardStore } from "../agent/kf-send-guard.js";
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
 * 为 wecom-kf 渠道会话注入 MEDIA: 发送说明。
 */
function registerWecomKfMediaPrompt(api: OpenClawPluginApi): void {
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
}

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
