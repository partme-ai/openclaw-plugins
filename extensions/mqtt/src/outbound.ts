/**
 * @module mqtt/outbound
 *
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

const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";

function parseDirectTarget(value: string): string | null {
  if (!value.startsWith(DIRECT_TARGET_PREFIX)) return null;
  const encoded = value.slice(DIRECT_TARGET_PREFIX.length);
  if (!encoded) throw new Error("[openclaw-mqtt] Explicit direct target is empty");
  try {
    const target = decodeURIComponent(encoded);
    if (!target) throw new Error("empty target");
    return target;
  } catch (error) {
    throw new Error(`[openclaw-mqtt] Invalid explicit direct target: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
    const directTarget = parseDirectTarget(ctx.to);
    if (directTarget) {
      if (!ctx.deliveryQueueId) throw new Error("[openclaw-mqtt] Explicit direct delivery requires deliveryQueueId");
      const cfg = getMqttChannelConfig() ?? DEFAULT_BROKER_CONFIG;
      await publishMessage(directTarget, ctx.text, 1, cfg.retain.outboundRetain);
      return { channel: "mqtt", messageId: ctx.deliveryQueueId };
    }
    const sessionKey = ctx.to;
    const clientId = getClientIdBySession(sessionKey);
    if (!clientId) {
      throw new Error(`[openclaw-mqtt] Cannot send — no client for session: ${sessionKey}`);
    }

    const sessionContext = getSessionContext(sessionKey);
    const agentId = sessionContext?.agentId;
    if (!agentId) {
      throw new Error(`[openclaw-mqtt] Cannot send — missing session context agentId: ${sessionKey}`);
    }
    const outTopic = sessionContext.replyTopic ?? buildOutboundTopic(agentId);
    const cfg = getMqttChannelConfig() ?? DEFAULT_BROKER_CONFIG;
    const username = getClientUsername(clientId);
    const user = cfg.auth.users.find((entry) => entry.username === username);
    if (
      cfg.auth.enabled &&
      (!user ||
        !isUserActionAllowed({
          user,
          action: "outbound",
          topic: outTopic,
          accountId: sessionContext?.accountId ?? "default",
        }))
    ) {
      logAuditEvent(cfg.audit, "warn", user ? "acl_outbound_denied" : "acl_outbound_identity_missing", {
        clientId,
        username: username ?? null,
        topic: outTopic,
        accountId: sessionContext?.accountId ?? "default",
      });
      throw new Error(
        `[openclaw-mqtt] Cannot send — ${user ? "outbound ACL denied" : "authenticated identity missing"} for topic: ${outTopic}`,
      );
    }

    await publishMessage(outTopic, ctx.text, 0, cfg.retain.outboundRetain);

    console.log(`[openclaw-mqtt] Reply published to ${outTopic} for client ${clientId}`);
    return { channel: "mqtt", messageId: sessionKey };
  },
};
