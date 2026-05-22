import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "./src/openclaw-compat.js";
import { resolveWecomChannelPlugin } from "./src/channel-factory.js";
import { createWeComMcpTool } from "./src/mcp/index.js";
import { getSessionChatInfo } from "./src/state-manager.js";
import { setWeComRuntime } from "./src/runtime.js";
import { CHANNEL_ID, WEBHOOK_PATHS } from "./src/const.js";
import { createWecomAgentWebhookHandler } from "./src/agent/webhook.js";
import { handleWecomWebhookRequest } from "./src/webhook/index.js";
import { handleTempMediaRequest } from "./src/outbound-reply.js";

const plugin = {
  id: "wecom",
  name: "企业微信",
  description: "企业微信 OpenClaw 插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.logger.info("[wecom] Plugin registered");

    // Set up runtime
    setWeComRuntime(api.runtime);
    api.registerChannel({ plugin: resolveWecomChannelPlugin() });

    // Register wecom_mcp tool: direct HTTP calls to WeCom MCP Server
    api.registerTool(
      (ctx: OpenClawPluginToolContext) => {
        const trustedRequesterUserId =
          ctx.messageChannel === CHANNEL_ID ? ctx.requesterSenderId?.trim() ?? undefined : undefined;

        // Retrieve original-case chatId/chatType by sessionKey
        // Data is written by monitor.ts during inbound message processing via setSessionChatInfo
        // This avoids using parseSessionKeyChat which lowercases chatId
        // (lowercased chatId causes "invalid chatid" errors in WeCom aibot_send_biz_msg API)
        const sessionChat = getSessionChatInfo(ctx.sessionKey);
        api.logger?.debug?.(
          `[wecom] MCP tool context: sessionKey="${ctx.sessionKey}", messageChannel="${ctx.messageChannel}", ` +
          `requesterSenderId="${ctx.requesterSenderId}", agentAccountId="${ctx.agentAccountId}", ` +
          `sessionChat=${JSON.stringify(sessionChat)}`,
        );
        return createWeComMcpTool({
          requesterUserId: trustedRequesterUserId,
          accountId: ctx.agentAccountId,
          chatId: sessionChat?.chatId,
          chatType: sessionChat?.chatType,
        });
      },
      { name: "wecom_mcp" },
    );

    // Create Agent webhook handler (wraps handleAgentWebhook with signature verification)
    const agentWebhookHandler = createWecomAgentWebhookHandler(api.runtime);

    // Register Agent mode HTTP webhook routes (prefix match covers accountId sub-paths)
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT_PLUGIN,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });

    // Register Bot mode HTTP webhook routes (prefix match covers all variants)
    const botRoutes = [WEBHOOK_PATHS.BOT_PLUGIN, WEBHOOK_PATHS.BOT_ALT, WEBHOOK_PATHS.BOT];
    for (const routePath of botRoutes) {
      api.registerHttpRoute({
        path: routePath,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    // Register temp media server route (token-authenticated, 15-minute TTL)
    api.registerHttpRoute({
      path: "/wecom-media",
      handler: handleTempMediaRequest as any,
      auth: "plugin",
    });

    // Inject media sending instructions and file size limit hints (only for WeCom channel)
    api.on("before_prompt_build", (_event, ctx) => {
      // Only inject in WeCom channel sessions to avoid affecting other channel plugins
      if (ctx?.channelId !== CHANNEL_ID) {
        return;
      }
      return {
        appendSystemContext: [
          "重要：涉及发送图片/视频/语音/文件给用户时，请务必使用 `MEDIA:` 指令。详见 wecom-send-media 这个 skill（技能）。",
          "重要：当需要向用户发送结构化卡片消息（如通知、投票、按钮选择等）时，请在回复中直接输出 JSON 代码块（```json ... ```），其中 card_type 字段标明卡片类型。详见 wecom-send-template-card 技能。"
        ].join("\n"),
      };
    });
  },
};

export default plugin;
