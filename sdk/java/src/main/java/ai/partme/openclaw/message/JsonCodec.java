package ai.partme.openclaw.message;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON codec for OpenClaw message shapes (zero external dependencies).
 */
final class JsonCodec {

    private JsonCodec() {}

    static String serializeEnvelope(MessageEnvelope envelope) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"version\":\"1\",\"message\":");
        sb.append(serializeMessage(envelope.message()));
        if (envelope.headers() != null) {
            sb.append(",\"headers\":");
            sb.append(serializeHeaders(envelope.headers()));
        }
        sb.append('}');
        return sb.toString();
    }

    static String serializeLegacyText(String text) {
        return "{\"text\":" + quote(text) + "}";
    }

    static String serializeMessage(UnifiedMessage message) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        appendField(sb, "messageId", message.messageId());
        appendField(sb, "traceId", message.traceId());
        appendNumberField(sb, "timestamp", message.timestamp());
        sb.append("\"source\":");
        sb.append(serializeSource(message.source()));
        appendField(sb, "contentType", message.contentType());
        appendField(sb, "text", message.text());
        sb.append("\"media\":[],");
        appendField(sb, "direction", message.direction());
        trimTrailingComma(sb);
        sb.append('}');
        return sb.toString();
    }

    private static String serializeSource(UnifiedMessageSource source) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        appendField(sb, "channel", source.channel());
        appendField(sb, "accountId", source.accountId());
        appendField(sb, "userId", source.userId());
        appendField(sb, "chatType", source.chatType());
        if (source.agentId() != null && !source.agentId().isBlank()) {
            appendField(sb, "agentId", source.agentId());
        }
        trimTrailingComma(sb);
        sb.append('}');
        return sb.toString();
    }

    private static String serializeHeaders(MessageEnvelopeHeaders headers) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        if (headers.correlationId() != null) {
            appendField(sb, "correlationId", headers.correlationId());
        }
        if (headers.idempotencyKey() != null) {
            appendField(sb, "idempotencyKey", headers.idempotencyKey());
        }
        if (headers.replyRoute() != null && !headers.replyRoute().isEmpty()) {
            sb.append("\"replyRoute\":");
            sb.append(serializeStringMap(headers.replyRoute()));
            sb.append(',');
        }
        trimTrailingComma(sb);
        sb.append('}');
        return sb.toString();
    }

    private static String serializeStringMap(Map<String, String> map) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        for (Map.Entry<String, String> entry : map.entrySet()) {
            appendField(sb, entry.getKey(), entry.getValue());
        }
        trimTrailingComma(sb);
        sb.append('}');
        return sb.toString();
    }

    static MessageEnvelope parseEnvelope(String raw) {
        Map<String, Object> root = parseObject(raw);
        if (root == null) {
            return null;
        }
        if ("1".equals(asString(root.get("version"))) && root.get("message") instanceof Map<?, ?> msgMap) {
            UnifiedMessage message = mapToMessage(castMap(msgMap));
            if (message == null) {
                return null;
            }
            MessageEnvelopeHeaders headers = null;
            if (root.get("headers") instanceof Map<?, ?> headerMap) {
                headers = mapToHeaders(castMap(headerMap));
            }
            return MessageEnvelope.of(message, headers);
        }
        UnifiedMessage legacy = mapToMessage(root);
        if (legacy != null) {
            return MessageEnvelope.of(legacy, null);
        }
        return null;
    }

    static ParsedTransportPayload parseTransportPayload(String raw, String mode) {
        if ("plain".equals(mode)) {
            return ParsedTransportPayload.plain(raw);
        }

        MessageEnvelope envelope = parseEnvelope(raw);
        if (envelope != null && envelope.message().text() != null && !envelope.message().text().isBlank()) {
            UnifiedMessage msg = envelope.message();
            Map<String, Object> meta = msg.metadata() == null ? Map.of() : msg.metadata();
            String correlationId = envelope.headers() == null ? null : envelope.headers().correlationId();
            String idempotencyKey = envelope.headers() == null ? null : envelope.headers().idempotencyKey();
            Map<String, String> replyRoute = envelope.headers() == null ? null : envelope.headers().replyRoute();
            if (correlationId == null) {
                correlationId = asString(meta.get("correlationId"));
            }
            if (idempotencyKey == null) {
                idempotencyKey = asString(meta.get("idempotencyKey"));
            }
            return new ParsedTransportPayload(msg.text(), msg, correlationId, idempotencyKey, replyRoute);
        }

        UnifiedMessage unified = mapToMessage(parseObject(raw));
        if (unified != null && unified.text() != null && !unified.text().isBlank()) {
            Map<String, Object> meta = unified.metadata() == null ? Map.of() : unified.metadata();
            return new ParsedTransportPayload(
                unified.text(),
                unified,
                asString(meta.get("correlationId")),
                asString(meta.get("idempotencyKey")),
                null
            );
        }

        if ("jsonOnly".equals(mode)) {
            return ParsedTransportPayload.plain("");
        }

        Map<String, Object> legacy = parseObject(raw);
        if (legacy != null) {
            String text = asString(legacy.get("text"));
            if (text != null && !text.isBlank()) {
                return new ParsedTransportPayload(
                    text,
                    null,
                    asString(legacy.get("correlationId")),
                    asString(legacy.get("idempotencyKey")),
                    null
                );
            }
        }

        return ParsedTransportPayload.plain(raw);
    }

    private static UnifiedMessage mapToMessage(Map<String, Object> map) {
        if (map == null) {
            return null;
        }
        String messageId = asString(map.get("messageId"));
        String text = asString(map.get("text"));
        Object sourceObj = map.get("source");
        if (messageId == null || text == null || !(sourceObj instanceof Map<?, ?> sourceMapRaw)) {
            return null;
        }
        Map<String, Object> sourceMap = castMap(sourceMapRaw);
        String channel = asString(sourceMap.get("channel"));
        if (channel == null) {
            return null;
        }
        UnifiedMessageSource source = new UnifiedMessageSource(
            channel,
            asString(sourceMap.get("accountId")),
            asString(sourceMap.get("userId")),
            asString(sourceMap.get("chatType")) == null ? "direct" : asString(sourceMap.get("chatType")),
            asString(sourceMap.get("agentId"))
        );
        return UnifiedMessage.builder()
            .messageId(messageId)
            .traceId(asString(map.get("traceId")))
            .timestamp(asLong(map.get("timestamp")))
            .source(source)
            .contentType(asString(map.get("contentType")) == null ? "text" : asString(map.get("contentType")))
            .text(text)
            .media(List.of())
            .direction(asString(map.get("direction")) == null ? "inbound" : asString(map.get("direction")))
            .build();
    }

    private static MessageEnvelopeHeaders mapToHeaders(Map<String, Object> map) {
        Map<String, String> replyRoute = null;
        Object routeObj = map.get("replyRoute");
        if (routeObj instanceof Map<?, ?> routeMap) {
            replyRoute = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : routeMap.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    replyRoute.put(entry.getKey().toString(), entry.getValue().toString());
                }
            }
        }
        return new MessageEnvelopeHeaders(
            asString(map.get("correlationId")),
            asString(map.get("idempotencyKey")),
            replyRoute,
            asString(map.get("encoding"))
        );
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String str) {
            try {
                return Long.parseLong(str);
            } catch (NumberFormatException ignored) {
                return System.currentTimeMillis();
            }
        }
        return System.currentTimeMillis();
    }

    private static void appendField(StringBuilder sb, String key, String value) {
        sb.append('"').append(escape(key)).append("\":");
        if (value == null) {
            sb.append("null,");
        } else {
            sb.append(quote(value)).append(',');
        }
    }

    private static void appendNumberField(StringBuilder sb, String key, long value) {
        sb.append('"').append(escape(key)).append("\":").append(value).append(',');
    }

    private static String quote(String value) {
        return "\"" + escape(value) + "\"";
    }

    private static String escape(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private static void trimTrailingComma(StringBuilder sb) {
        int len = sb.length();
        if (len > 0 && sb.charAt(len - 1) == ',') {
            sb.deleteCharAt(len - 1);
        }
    }

    static Map<String, Object> parseObject(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
            return null;
        }
        try {
            return new JsonObjectParser(trimmed).parseObject();
        } catch (RuntimeException ex) {
            return null;
        }
    }

    /** Tiny JSON object parser for flat/nested objects used by this SDK. */
    private static final class JsonObjectParser {
        private final String input;
        private int index;

        JsonObjectParser(String input) {
            this.input = input;
        }

        Map<String, Object> parseObject() {
            Map<String, Object> result = new LinkedHashMap<>();
            expect('{');
            skipWhitespace();
            if (peek() == '}') {
                index++;
                return result;
            }
            while (index < input.length()) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                expect(':');
                skipWhitespace();
                Object value = parseValue();
                result.put(key, value);
                skipWhitespace();
                if (peek() == ',') {
                    index++;
                    continue;
                }
                if (peek() == '}') {
                    index++;
                    break;
                }
            }
            return result;
        }

        private Object parseValue() {
            skipWhitespace();
            char c = peek();
            if (c == '"') {
                return parseString();
            }
            if (c == '{') {
                return parseObject();
            }
            if (c == '[') {
                return parseArray();
            }
            return parseLiteral();
        }

        private Object parseArray() {
            expect('[');
            skipWhitespace();
            if (peek() == ']') {
                index++;
                return List.of();
            }
            List<Object> items = new java.util.ArrayList<>();
            while (index < input.length()) {
                items.add(parseValue());
                skipWhitespace();
                if (peek() == ',') {
                    index++;
                    continue;
                }
                if (peek() == ']') {
                    index++;
                    break;
                }
            }
            return items;
        }

        private Object parseLiteral() {
            int start = index;
            while (index < input.length()) {
                char c = input.charAt(index);
                if (c == ',' || c == '}' || c == ']') {
                    break;
                }
                index++;
            }
            String literal = input.substring(start, index).trim();
            if ("null".equals(literal)) {
                return null;
            }
            if ("true".equals(literal)) {
                return Boolean.TRUE;
            }
            if ("false".equals(literal)) {
                return Boolean.FALSE;
            }
            try {
                if (literal.contains(".")) {
                    return Double.parseDouble(literal);
                }
                return Long.parseLong(literal);
            } catch (NumberFormatException ex) {
                return literal;
            }
        }

        private String parseString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (index < input.length()) {
                char c = input.charAt(index++);
                if (c == '"') {
                    return sb.toString();
                }
                if (c == '\\') {
                    char next = input.charAt(index++);
                    sb.append(switch (next) {
                        case '"', '\\', '/' -> next;
                        case 'b' -> '\b';
                        case 'f' -> '\f';
                        case 'n' -> '\n';
                        case 'r' -> '\r';
                        case 't' -> '\t';
                        case 'u' -> (char) Integer.parseInt(input.substring(index, index + 4), 16);
                        default -> next;
                    });
                    if (next == 'u') {
                        index += 4;
                    }
                    continue;
                }
                sb.append(c);
            }
            throw new IllegalArgumentException("Unterminated string");
        }

        private void expect(char expected) {
            skipWhitespace();
            if (input.charAt(index) != expected) {
                throw new IllegalArgumentException("Expected '" + expected + "' at " + index);
            }
            index++;
        }

        private char peek() {
            skipWhitespace();
            return input.charAt(index);
        }

        private void skipWhitespace() {
            while (index < input.length() && Character.isWhitespace(input.charAt(index))) {
                index++;
            }
        }
    }
}
