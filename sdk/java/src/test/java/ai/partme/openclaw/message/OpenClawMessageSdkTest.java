package ai.partme.openclaw.message;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class OpenClawMessageSdkTest {

    @Test
    void roundTripsEnvelopeV1() {
        UnifiedMessage message = MessageFactory.buildMessage(
            "mqtt", "default", "device-1", "hello", null, "inbound"
        );
        MessageEnvelope envelope = OpenClawMessageSdk.buildEnvelope(
            message,
            new MessageEnvelopeHeaders("c-1", null, Map.of("topic", "reply/x"), null)
        );
        String raw = JsonCodec.serializeEnvelope(envelope);
        MessageEnvelope parsed = OpenClawMessageSdk.parseEnvelope(raw);
        assertNotNull(parsed);
        assertEquals("1", parsed.version());
        assertEquals("hello", parsed.message().text());
        assertEquals("c-1", parsed.headers().correlationId());
        assertEquals("reply/x", parsed.headers().replyRoute().get("topic"));
    }

    @Test
    void parsesLegacyTextJson() {
        ParsedTransportPayload parsed = OpenClawMessageSdk.parseTransportPayload(
            "{\"text\":\"legacy\"}",
            "jsonTextOrPlain"
        );
        assertEquals("legacy", parsed.text());
    }

    @Test
    void serializesOutboundFormats() {
        String envelope = OpenClawMessageSdk.serializeForTransport(
            "rabbitmq", "default", "peer", "reply", null,
            OpenClawMessageSdk.FORMAT_ENVELOPE, null, Map.of("topic", "reply/peer")
        );
        MessageEnvelope parsed = OpenClawMessageSdk.parseEnvelope(envelope);
        assertEquals("reply", parsed.message().text());
        assertEquals("outbound", parsed.message().direction());

        String legacy = OpenClawMessageSdk.serializeForTransport(
            "mqtt", "a", "u", "x", null,
            OpenClawMessageSdk.FORMAT_LEGACY_JSON_TEXT, null, null
        );
        assertEquals("{\"text\":\"x\"}", legacy);

        String plain = OpenClawMessageSdk.serializeForTransport(
            "mqtt", "a", "u", "plain", null,
            OpenClawMessageSdk.FORMAT_PLAIN_TEXT, null, null
        );
        assertEquals("plain", plain);
    }
}
