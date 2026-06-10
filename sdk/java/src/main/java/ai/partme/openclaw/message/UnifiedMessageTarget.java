package ai.partme.openclaw.message;

import java.util.List;

/**
 * Message routing target.
 */
public record UnifiedMessageTarget(List<String> channels, String routingRule) {}
