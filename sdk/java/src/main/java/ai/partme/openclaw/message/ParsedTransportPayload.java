package ai.partme.openclaw.message;

import java.util.Map;

/**
 * Parsed transport payload result.
 */
public record ParsedTransportPayload(
    String text,
    UnifiedMessage unified,
    String correlationId,
    String idempotencyKey,
    Map<String, String> replyRoute
) {
    /**
     * Creates a plain-text-only parse result.
     */
    public static ParsedTransportPayload plain(String text) {
        return new ParsedTransportPayload(text, null, null, null, null);
    }
}
