package ai.partme.openclaw.message;

/**
 * Message source identity.
 */
public record UnifiedMessageSource(
    String channel,
    String accountId,
    String userId,
    String chatType,
    String agentId
) {
    /**
     * Creates a direct-chat source.
     */
    public static UnifiedMessageSource of(String channel, String accountId, String userId) {
        return new UnifiedMessageSource(channel, accountId, userId, "direct", null);
    }
}
