package ai.partme.openclaw.message;

import java.util.Map;

/**
 * Wire envelope headers.
 */
public record MessageEnvelopeHeaders(
    String correlationId,
    String idempotencyKey,
    Map<String, String> replyRoute,
    String encoding
) {}
