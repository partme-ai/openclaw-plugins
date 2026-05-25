package openclaw

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeRoundTrip(t *testing.T) {
	msg := BuildMessage(BuildMessageParams{
		Channel:   "mqtt",
		AccountID: "default",
		UserID:    "device-1",
		Text:      "hello",
	})
	env := BuildEnvelope(msg, &MessageEnvelopeHeaders{
		CorrelationID: "c-1",
		ReplyRoute:    ReplyRoute{"topic": "reply/x"},
	})
	raw, err := SerializeEnvelope(env)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseEnvelope([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Version != "1" || parsed.Message.Text != "hello" {
		t.Fatalf("unexpected envelope: %+v", parsed)
	}
	if parsed.Headers.CorrelationID != "c-1" {
		t.Fatalf("missing correlationId")
	}
}

func TestParseTransportPayloadEnvelope(t *testing.T) {
	msg := BuildMessage(BuildMessageParams{Channel: "mqtt", AccountID: "a", UserID: "u", Text: "hi"})
	raw, _ := SerializeEnvelope(BuildEnvelope(msg, nil))
	got := ParseTransportPayload([]byte(raw), ParseJSONTextOrPlain)
	if got.Text != "hi" || got.Unified == nil || got.Unified.Source.Channel != "mqtt" {
		t.Fatalf("unexpected parse: %+v", got)
	}
}

func TestParseTransportPayloadLegacyText(t *testing.T) {
	raw, _ := json.Marshal(map[string]string{"text": "legacy"})
	got := ParseTransportPayload(raw, ParseJSONTextOrPlain)
	if got.Text != "legacy" {
		t.Fatalf("expected legacy text")
	}
}

func TestParseTransportPayloadPlainMode(t *testing.T) {
	got := ParseTransportPayload([]byte("raw"), ParsePlain)
	if got.Text != "raw" {
		t.Fatalf("plain mode failed")
	}
}

func TestSerializeForTransportFormats(t *testing.T) {
	params := SerializeOutboundParams{
		Channel:   "rabbitmq",
		AccountID: "default",
		UserID:    "peer",
		Text:      "reply",
	}
	wire, err := SerializeForTransport(params)
	if err != nil {
		t.Fatal(err)
	}
	env, err := ParseEnvelope([]byte(wire))
	if err != nil || env.Message.Text != "reply" || env.Message.Direction != DirectionOutbound {
		t.Fatalf("envelope reply failed: %+v", env)
	}

	legacy, err := SerializeForTransport(SerializeOutboundParams{
		Channel: "mqtt", AccountID: "a", UserID: "u", Text: "x", Format: FormatLegacyJSONText,
	})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]string
	if err := json.Unmarshal([]byte(legacy), &obj); err != nil || obj["text"] != "x" {
		t.Fatalf("legacy json failed")
	}

	plain, err := SerializeForTransport(SerializeOutboundParams{
		Channel: "mqtt", AccountID: "a", UserID: "u", Text: "plain", Format: FormatPlainText,
	})
	if err != nil || plain != "plain" {
		t.Fatalf("plain text failed")
	}
}
