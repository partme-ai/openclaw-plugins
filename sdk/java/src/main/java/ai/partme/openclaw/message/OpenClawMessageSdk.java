package ai.partme.openclaw.message;

import java.util.Map;

/**
 * Public facade for OpenClaw queue message parse/serialize helpers.
 */
public final class OpenClawMessageSdk {

    /** Outbound wire format: standard envelope. */
    public static final String FORMAT_ENVELOPE = "envelope";
    /** Outbound wire format: legacy {@code {"text":"..."}} JSON. */
    public static final String FORMAT_LEGACY_JSON_TEXT = "legacyJsonText";
    /** Outbound wire format: plain text. */
    public static final String FORMAT_PLAIN_TEXT = "plainText";

    private OpenClawMessageSdk() {}

    /**
     * Builds a version-1 envelope around a unified message.
     */
    public static MessageEnvelope buildEnvelope(UnifiedMessage message, MessageEnvelopeHeaders headers) {
        return MessageEnvelope.of(message, headers);
    }

    /**
     * Builds an outbound envelope with text body.
     */
    public static MessageEnvelope buildOutboundEnvelope(
        String channel,
        String accountId,
        String userId,
        String text,
        String agentId,
        MessageEnvelopeHeaders headers
    ) {
        UnifiedMessage message = MessageFactory.buildMessage(
            channel, accountId, userId, text, agentId, "outbound"
        );
        return buildEnvelope(message, headers);
    }

    /**
     * Parses envelope JSON.
     */
    public static MessageEnvelope parseEnvelope(String raw) {
        return JsonCodec.parseEnvelope(raw);
    }

    /**
     * Normalizes inbound wire payload.
     */
    public static ParsedTransportPayload parseTransportPayload(String raw, String mode) {
        return JsonCodec.parseTransportPayload(raw, mode);
    }

    /**
     * Serializes outbound reply for wire transport.
     */
    public static String serializeForTransport(
        String channel,
        String accountId,
        String userId,
        String text,
        String agentId,
        String format,
        MessageEnvelopeHeaders headers,
        Map<String, String> replyRoute
    ) {
        String wireFormat = format == null ? FORMAT_ENVELOPE : format;
        if (FORMAT_PLAIN_TEXT.equals(wireFormat)) {
            return text;
        }
        if (FORMAT_LEGACY_JSON_TEXT.equals(wireFormat)) {
            return JsonCodec.serializeLegacyText(text);
        }
        MessageEnvelopeHeaders merged = headers;
        if (replyRoute != null && !replyRoute.isEmpty()) {
            merged = new MessageEnvelopeHeaders(
                headers == null ? null : headers.correlationId(),
                headers == null ? null : headers.idempotencyKey(),
                replyRoute,
                headers == null ? null : headers.encoding()
            );
        }
        MessageEnvelope envelope = buildOutboundEnvelope(
            channel, accountId, userId, text, agentId, merged
        );
        return JsonCodec.serializeEnvelope(envelope);
    }

    /**
     * Reads reply route from envelope headers.
     */
    public static Map<String, String> getReplyRoute(MessageEnvelope envelope) {
        return envelope.headers() == null ? null : envelope.headers().replyRoute();
    }
}
