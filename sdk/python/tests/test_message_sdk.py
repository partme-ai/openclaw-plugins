"""Tests for OpenClaw message SDK."""

import json
import unittest

from openclaw_message_sdk import (
    build_envelope,
    build_message,
    parse_envelope,
    parse_transport_payload,
    serialize_envelope,
    serialize_for_transport,
)


class MessageEnvelopeTest(unittest.TestCase):
    def test_round_trip_envelope_v1(self) -> None:
        msg = build_message(
            {
                "channel": "mqtt",
                "accountId": "default",
                "userId": "device-1",
                "text": "hello",
            }
        )
        env = build_envelope(
            msg,
            {"correlationId": "c-1", "replyRoute": {"topic": "reply/x"}},
        )
        raw = serialize_envelope(env)
        parsed = parse_envelope(raw)
        self.assertEqual(parsed["version"], "1")
        self.assertEqual(parsed["message"]["text"], "hello")
        self.assertEqual(parsed["headers"]["correlationId"], "c-1")
        self.assertEqual(parsed["headers"]["replyRoute"]["topic"], "reply/x")


class ParseTransportPayloadTest(unittest.TestCase):
    def test_parses_envelope_json(self) -> None:
        msg = build_message({"channel": "mqtt", "accountId": "a", "userId": "u", "text": "hi"})
        raw = serialize_envelope(build_envelope(msg))
        result = parse_transport_payload(raw)
        self.assertEqual(result["text"], "hi")
        self.assertEqual(result["unified"]["source"]["channel"], "mqtt")

    def test_legacy_text_json(self) -> None:
        result = parse_transport_payload(json.dumps({"text": "legacy"}))
        self.assertEqual(result["text"], "legacy")

    def test_plain_mode(self) -> None:
        self.assertEqual(parse_transport_payload("raw", "plain")["text"], "raw")

    def test_json_only_invalid(self) -> None:
        self.assertEqual(parse_transport_payload("not-json", "jsonOnly")["text"], "")


class SerializeForTransportTest(unittest.TestCase):
    def test_default_envelope(self) -> None:
        wire = serialize_for_transport(
            {
                "channel": "rabbitmq",
                "accountId": "default",
                "userId": "peer",
                "text": "reply",
            }
        )
        parsed = parse_envelope(wire)
        self.assertEqual(parsed["message"]["text"], "reply")
        self.assertEqual(parsed["message"]["direction"], "outbound")

    def test_legacy_json_text(self) -> None:
        wire = serialize_for_transport(
            {
                "channel": "mqtt",
                "accountId": "a",
                "userId": "u",
                "text": "x",
                "format": "legacyJsonText",
            }
        )
        self.assertEqual(json.loads(wire), {"text": "x"})

    def test_plain_text(self) -> None:
        wire = serialize_for_transport(
            {
                "channel": "mqtt",
                "accountId": "a",
                "userId": "u",
                "text": "plain",
                "format": "plainText",
            }
        )
        self.assertEqual(wire, "plain")


if __name__ == "__main__":
    unittest.main()
