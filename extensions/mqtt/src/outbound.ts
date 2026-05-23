/**
 * MQTT 渠道出站适配器：将 Agent 回复发布到 MQTT Topic。
 */

import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";
import { chunkText } from "openclaw/plugin-sdk/reply-runtime";
import { sanitizeForPlainText } from "openclaw/plugin-sdk/outbound-runtime";

import { publishMessage } from "./transport/server.js";
import { DEFAULT_BROKER_CONFIG } from "./config.js";
import { getMqttChannelConfig } from "./state/mqtt-state.js";
import { getClientIdBySession, getSessionContext } from "./routing/session-mapper.js";
import { buildOutboundTopic } from "./routing/topic-router.js";
import { getClientUsername } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import { logAuditEvent } from "./transport/audit.js";

/**
 * OpenClaw ChannelOutboundAdapter：直连文本发布到 Aedes。
 */
export const mqttOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkText,
  chunkerMode: "text",
  textChunkLimit: 4000,
  sanitizeText: ({ text }) => sanitizeForPlainText(text),
  sendText: async (ctx: ChannelOutboundContext) => {
    const sessionKey = ctx.to;
    const clientId = getClientIdBySession(sessionKey);
    if (!clientId) {
      console.warn(`[openclaw-mqtt] Cannot send — no client for session: ${sessionKey}`);
      return { channel: "mqtt", messageId: "no-client" };
    }

    const sessionContext = getSessionContext(sessionKey);
    const agentId = sessionContext?.agentId;
    if (!agentId) {
      console.error(`[openclaw-mqtt] Cannot send — missing session context agentId: ${sessionKey}`);
      return { channel: "mqtt", messageId: "no-session-context" };
    }
    const outTopic = sessionContext.replyTopic ?? buildOutboundTopic(agentId);
    const cfg = getMqttChannelConfig() ?? DEFAULT_BROKER_CONFIG;
    const username = getClientUsername(clientId);
    const user = cfg.auth.users.find((entry) => entry.username === username);
    if (
      user &&
      !isUserActionAllowed({
        user,
        action: "outbound",
        topic: outTopic,
        accountId: sessionContext?.accountId ?? "default",
      })
    ) {
      logAuditEvent(cfg.audit, "warn", "acl_outbound_denied", {
        clientId,
        username,
        topic: outTopic,
        accountId: sessionContext?.accountId ?? "default",
      });
      return { channel: "mqtt", messageId: "acl-denied" };
    }

    publishMessage(outTopic, ctx.text, 0, cfg.retain.outboundRetain);

    console.log(`[openclaw-mqtt] Reply published to ${outTopic} for client ${clientId}`);
    return { channel: "mqtt", messageId: sessionKey };
  },
};
