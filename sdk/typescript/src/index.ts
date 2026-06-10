/**
 * @partme/openclaw-message-sdk — lightweight queue message envelope SDK.
 *
 * Aligns with extensions/message-sdk wire contracts without workspace coupling.
 */

export type {
  BuildMessageParams,
  MediaKind,
  MediaReference,
  MessageContentType,
  MessageDirection,
  MessageEnvelope,
  MessageEnvelopeHeaders,
  OutboundWireFormat,
  ParsedTransportPayload,
  PayloadParseMode,
  ReplyRoute,
  SerializeOutboundParams,
  UnifiedMessage,
  UnifiedMessageSource,
  UnifiedMessageTarget,
} from "./types.js";

export {
  buildMessage,
  generateCorrelationId,
  generateMessageId,
  generateTraceId,
  parseMessage,
  parseMessageAny,
  serializeMessage,
} from "./message.js";

export {
  buildEnvelope,
  buildOutboundEnvelope,
  extractRoutingMetadata,
  getReplyRoute,
  mergeReplyRouteIntoHeaders,
  parseEnvelope,
  parseEnvelopeAny,
  serializeEnvelope,
} from "./envelope.js";

export { parseTransportPayload } from "./parse-payload.js";
export { serializeForTransport } from "./serialize-payload.js";
