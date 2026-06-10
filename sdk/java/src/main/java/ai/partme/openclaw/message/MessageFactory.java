package ai.partme.openclaw.message;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * UnifiedMessage construction and ID helpers.
 */
public final class MessageFactory {

    private static final SecureRandom RANDOM = new SecureRandom();

    private MessageFactory() {}

    /**
     * Generates a trace id.
     */
    public static String generateTraceId() {
        return Long.toString(System.currentTimeMillis(), 36) + "-" + randomSuffix(8);
    }

    /**
     * Generates a message id with optional channel prefix.
     */
    public static String generateMessageId(String channel) {
        String prefix = channel == null || channel.isBlank() ? "" : channel + "-";
        return prefix + Long.toString(System.currentTimeMillis(), 36) + "-" + randomSuffix(6);
    }

    /**
     * Generates a correlation id.
     */
    public static String generateCorrelationId(String prefix) {
        String p = prefix == null || prefix.isBlank() ? "corr" : prefix;
        return p + "-" + Long.toString(System.currentTimeMillis(), 36) + "-" + randomSuffix(6);
    }

    /**
     * Builds a unified message from parameters.
     */
    public static UnifiedMessage buildMessage(
        String channel,
        String accountId,
        String userId,
        String text,
        String agentId,
        String direction
    ) {
        String contentType = "text";
        return UnifiedMessage.builder()
            .messageId(generateMessageId(channel))
            .traceId(generateTraceId())
            .timestamp(Instant.now().toEpochMilli())
            .source(new UnifiedMessageSource(channel, accountId, userId, "direct", agentId))
            .contentType(contentType)
            .text(text == null ? "" : text)
            .media(List.of())
            .direction(direction == null ? "inbound" : direction)
            .build();
    }

    private static String randomSuffix(int length) {
        byte[] bytes = new byte[(length + 1) / 2];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes).substring(0, length);
    }
}
