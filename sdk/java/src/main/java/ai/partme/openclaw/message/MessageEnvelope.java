package ai.partme.openclaw.message;

import java.util.Map;

/**
 * Version-1 wire transport envelope.
 */
public record MessageEnvelope(
    String version,
    UnifiedMessage message,
    MessageEnvelopeHeaders headers
) {
    /**
     * Wraps a unified message in version-1 envelope.
     */
    public static MessageEnvelope of(UnifiedMessage message, MessageEnvelopeHeaders headers) {
        return new MessageEnvelope("1", message, headers);
    }
}

