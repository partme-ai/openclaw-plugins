import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { emptyChannelConfigSchema } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { wecomPlugin } from "./channel.js";
import { createWeComMcpTool } from "./mcp/index.js";
import { getSessionChatInfo } from "./state-manager.js";
import { setWeComRuntime } from "./runtime.js";
import { CHANNEL_ID, WEBHOOK_PATHS } from "./const.js";
import { createWecomAgentWebhookHandler, handleWecomWebhookRequest } from "./transport/server.js";
import { handleTempMediaRequest } from "./outbound.js";

export { wecomPlugin } from "./channel.js";
export { setWeComRuntime, getWeComRuntime } from "./runtime.js";

/**
 * 企业微信 OpenClaw 通道插件入口。
 */
export default defineChannelPluginEntry({
  id: "wecom",
  name: "企业微信",
  description: "企业微信 OpenClaw 插件",
  plugin: wecomPlugin,
  configSchema: emptyChannelConfigSchema(),
  setRuntime: setWeComRuntime,
  registerFull(api: OpenClawPluginApi) {
    api.logger.info("[wecom] Plugin registered (full mode)");

    api.registerTool(
      (ctx: OpenClawPluginToolContext) => {
        const trustedRequesterUserId =
          ctx.messageChannel === CHANNEL_ID ? ctx.requesterSenderId?.trim() ?? undefined : undefined;

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

    const agentWebhookHandler = createWecomAgentWebhookHandler(api.runtime);

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

    const botRoutes = [WEBHOOK_PATHS.BOT_PLUGIN, WEBHOOK_PATHS.BOT_ALT, WEBHOOK_PATHS.BOT];
    for (const routePath of botRoutes) {
      api.registerHttpRoute({
        path: routePath,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }

    api.registerHttpRoute({
      path: "/wecom-media",
      handler: handleTempMediaRequest as Parameters<OpenClawPluginApi["registerHttpRoute"]>[0]["handler"],
      auth: "plugin",
    });

    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx?.channelId !== CHANNEL_ID) {
        return;
      }
      return {
        appendSystemContext: [
          "重要：涉及发送图片/视频/语音/文件给用户时，请务必使用 `MEDIA:` 指令。详见 wecom-send-media 这个 skill（技能）。",
          "重要：当需要向用户发送结构化卡片消息（如通知、投票、按钮选择等）时，请在回复中直接输出 JSON 代码块（```json ... ```），其中 card_type 字段标明卡片类型。详见 wecom-send-template-card 技能。",
        ].join("\n"),
      };
    });
  },
});
