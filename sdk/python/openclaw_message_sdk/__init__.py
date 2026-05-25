"""OpenClaw queue message envelope SDK (Python, zero external deps)."""

from openclaw_message_sdk.envelope import (
    build_envelope,
    build_outbound_envelope,
    get_reply_route,
    parse_envelope,
    parse_envelope_any,
    serialize_envelope,
)
from openclaw_message_sdk.message import (
    build_message,
    generate_correlation_id,
    generate_message_id,
    generate_trace_id,
    parse_message,
    parse_message_any,
    serialize_message,
)
from openclaw_message_sdk.parse_payload import parse_transport_payload
from openclaw_message_sdk.serialize_payload import serialize_for_transport
from openclaw_message_sdk.types import (
    BuildMessageParams,
    MessageEnvelope,
    MessageEnvelopeHeaders,
    OutboundWireFormat,
    ParsedTransportPayload,
    PayloadParseMode,
    ReplyRoute,
    SerializeOutboundParams,
    UnifiedMessage,
)

__all__ = [
    "BuildMessageParams",
    "MessageEnvelope",
    "MessageEnvelopeHeaders",
    "OutboundWireFormat",
    "ParsedTransportPayload",
    "PayloadParseMode",
    "ReplyRoute",
    "SerializeOutboundParams",
    "UnifiedMessage",
    "build_envelope",
    "build_message",
    "build_outbound_envelope",
    "generate_correlation_id",
    "generate_message_id",
    "generate_trace_id",
    "get_reply_route",
    "parse_envelope",
    "parse_envelope_any",
    "parse_message",
    "parse_message_any",
    "parse_transport_payload",
    "serialize_envelope",
    "serialize_for_transport",
    "serialize_message",
]

__version__ = "0.1.0"
