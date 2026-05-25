package ai.partme.openclaw.message;

import java.util.List;
import java.util.Map;

/**
 * Unified message body (legacy wire shape).
 */
public record UnifiedMessage(
    String messageId,
    String traceId,
    long timestamp,
    UnifiedMessageSource source,
    UnifiedMessageTarget target,
    String contentType,
    String text,
    String markdown,
    List<MediaReference> media,
    String replyToMessageId,
    Map<String, Object> metadata,
    String direction
) {
    /**
     * Builder for {@link UnifiedMessage}.
     */
    public static Builder builder() {
        return new Builder();
    }

    /** Fluent builder. */
    public static final class Builder {
        private String messageId;
        private String traceId;
        private long timestamp;
        private UnifiedMessageSource source;
        private UnifiedMessageTarget target;
        private String contentType = "text";
        private String text = "";
        private String markdown;
        private List<MediaReference> media = List.of();
        private String replyToMessageId;
        private Map<String, Object> metadata;
        private String direction = "inbound";

        public Builder messageId(String messageId) {
            this.messageId = messageId;
            return this;
        }

        public Builder traceId(String traceId) {
            this.traceId = traceId;
            return this;
        }

        public Builder timestamp(long timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder source(UnifiedMessageSource source) {
            this.source = source;
            return this;
        }

        public Builder target(UnifiedMessageTarget target) {
            this.target = target;
            return this;
        }

        public Builder contentType(String contentType) {
            this.contentType = contentType;
            return this;
        }

        public Builder text(String text) {
            this.text = text;
            return this;
        }

        public Builder markdown(String markdown) {
            this.markdown = markdown;
            return this;
        }

        public Builder media(List<MediaReference> media) {
            this.media = media;
            return this;
        }

        public Builder replyToMessageId(String replyToMessageId) {
            this.replyToMessageId = replyToMessageId;
            return this;
        }

        public Builder metadata(Map<String, Object> metadata) {
            this.metadata = metadata;
            return this;
        }

        public Builder direction(String direction) {
            this.direction = direction;
            return this;
        }

        public UnifiedMessage build() {
            return new UnifiedMessage(
                messageId, traceId, timestamp, source, target, contentType, text, markdown,
                media, replyToMessageId, metadata, direction
            );
        }
    }
}
