"""MessageEnvelope build, parse, and serialize."""

from __future__ import annotations

import json
from typing import Any

from openclaw_message_sdk.message import build_message, parse_message, parse_message_any
from openclaw_message_sdk.types import (
    MessageEnvelope,
    MessageEnvelopeHeaders,
    ReplyRoute,
    UnifiedMessage,
)


def build_envelope(
    message: UnifiedMessage,
    headers: MessageEnvelopeHeaders | None = None,
) -> MessageEnvelope:
    """Wrap UnifiedMessage in a version-1 envelope."""
    envelope: MessageEnvelope = {"version": "1", "message": message}
    if headers:
        envelope["headers"] = headers
    return envelope


def build_outbound_envelope(
    *,
    channel: str,
    account_id: str,
    user_id: str,
    text: str,
    agent_id: str | None = None,
    reply_to_message_id: str | None = None,
    headers: MessageEnvelopeHeaders | None = None,
) -> MessageEnvelope:
    """Build an outbound envelope with text body."""
    params: dict[str, Any] = {
        "channel": channel,
        "accountId": account_id,
        "userId": user_id,
        "text": text,
        "direction": "outbound",
    }
    if agent_id:
        params["agentId"] = agent_id
    if reply_to_message_id:
        params["replyToMessageId"] = reply_to_message_id
    message = build_message(params)  # type: ignore[arg-type]
    return build_envelope(message, headers)


def parse_envelope(raw: str) -> MessageEnvelope | None:
    """Parse MessageEnvelope from JSON string."""
    try:
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return None
        if obj.get("version") == "1" and isinstance(obj.get("message"), dict):
            msg = obj["message"]
            source = msg.get("source") if isinstance(msg, dict) else None
            if not isinstance(msg.get("messageId"), str) or not isinstance(source, dict):
                return None
            if not isinstance(source.get("channel"), str):
                return None
            return obj  # type: ignore[return-value]
        legacy = parse_message(raw)
        if legacy:
            return {"version": "1", "message": legacy}
        return None
    except json.JSONDecodeError:
        return None


def parse_envelope_any(raw: str | bytes | bytearray | dict[str, Any]) -> MessageEnvelope | None:
    """Parse MessageEnvelope from string, bytes, or dict."""
    if isinstance(raw, (bytes, bytearray)):
        return parse_envelope(raw.decode("utf-8"))
    if isinstance(raw, str):
        return parse_envelope(raw)
    if isinstance(raw, dict):
        if raw.get("version") == "1" and raw.get("message"):
            return raw  # type: ignore[return-value]
        unified = parse_message_any(raw)
        if unified:
            return {"version": "1", "message": unified}
    return None


def get_reply_route(envelope: MessageEnvelope) -> ReplyRoute | None:
    """Read reply route from envelope headers."""
    headers = envelope.get("headers")
    if not headers:
        return None
    route = headers.get("replyRoute")
    return route if isinstance(route, dict) else None


def serialize_envelope(envelope: MessageEnvelope) -> str:
    """Serialize envelope to JSON string."""
    return json.dumps(envelope, ensure_ascii=False)
