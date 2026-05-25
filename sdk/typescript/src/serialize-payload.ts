/**
 * Unified transport outbound payload serialization.
 */

import { buildOutboundEnvelope, serializeEnvelope } from "./envelope.js";
import type { OutboundWireFormat, SerializeOutboundParams } from "./types.js";

/**
 * Serialize Agent reply for wire transport.
 */
export function serializeForTransport(params: SerializeOutboundParams): string {
  const format: OutboundWireFormat = params.format ?? "envelope";

  if (format === "plainText") {
    return params.text;
  }

  if (format === "legacyJsonText") {
    return JSON.stringify({ text: params.text });
  }

  const envelope = buildOutboundEnvelope({
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    text: params.text,
    agentId: params.agentId,
    headers: {
      ...params.headers,
      ...(params.replyRoute ? { replyRoute: params.replyRoute } : {}),
    },
  });
  return serializeEnvelope(envelope);
}
