package ai.partme.openclaw.message;

/**
 * Structured media attachment reference.
 */
public record MediaReference(
    String url,
    String kind,
    String mimeType,
    String fileName,
    Long sizeBytes,
    String base64,
    String thumbnailUrl,
    Double durationSeconds,
    Integer width,
    Integer height
) {}
