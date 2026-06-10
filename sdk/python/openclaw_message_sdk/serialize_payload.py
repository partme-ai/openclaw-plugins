"""Unified transport outbound payload serialization."""

from __future__ import annotations

import json

from openclaw_message_sdk.envelope import build_outbound_envelope, serialize_envelope
from openclaw_message_sdk.types import OutboundWireFormat, SerializeOutboundParams


def serialize_for_transport(params: SerializeOutboundParams) -> str:
    """Serialize Agent reply for wire transport."""
    wire_format: OutboundWireFormat = params.get("format", "envelope")
    text = params["text"]

    if wire_format == "plainText":
        return text

    if wire_format == "legacyJsonText":
        return json.dumps({"text": text}, ensure_ascii=False)

    headers = dict(params.get("headers") or {})
    reply_route = params.get("replyRoute")
    if reply_route:
        headers["replyRoute"] = reply_route

    envelope = build_outbound_envelope(
        channel=params["channel"],
        account_id=params["accountId"],
        user_id=params["userId"],
        text=text,
        agent_id=params.get("agentId"),
        headers=headers or None,
    )
    return serialize_envelope(envelope)
