"""Unified transport inbound payload parsing."""

from __future__ import annotations

import json

from openclaw_message_sdk.envelope import parse_envelope_any
from openclaw_message_sdk.message import parse_message_any
from openclaw_message_sdk.types import ParsedTransportPayload, PayloadParseMode


def parse_transport_payload(
    raw_payload: str,
    mode: PayloadParseMode = "jsonTextOrPlain",
) -> ParsedTransportPayload:
    """
    Parse raw transport payload.

    Order: envelope v1 → legacy UnifiedMessage → `{ text }` JSON → plain fallback.
    """
    if mode == "plain":
        return {"text": raw_payload, "unified": None}

    envelope = parse_envelope_any(raw_payload)
    if envelope and envelope.get("message", {}).get("text"):
        msg = envelope["message"]
        meta = msg.get("metadata") or {}
        headers = envelope.get("headers") or {}
        return {
            "text": msg["text"],
            "unified": msg,
            "correlationId": headers.get("correlationId")
            or (meta.get("correlationId") if isinstance(meta.get("correlationId"), str) else None),
            "idempotencyKey": headers.get("idempotencyKey")
            or (
                meta.get("idempotencyKey")
                if isinstance(meta.get("idempotencyKey"), str)
                else None
            ),
            "replyRoute": headers.get("replyRoute"),
        }

    unified_msg = parse_message_any(raw_payload)
    if unified_msg and unified_msg.get("text"):
        meta = unified_msg.get("metadata") or {}
        return {
            "text": unified_msg["text"],
            "unified": unified_msg,
            "correlationId": meta.get("correlationId")
            if isinstance(meta.get("correlationId"), str)
            else None,
            "idempotencyKey": meta.get("idempotencyKey")
            if isinstance(meta.get("idempotencyKey"), str)
            else None,
        }

    if mode == "jsonOnly":
        return {"text": "", "unified": None}

    try:
        parsed = json.loads(raw_payload)
        if isinstance(parsed, dict) and isinstance(parsed.get("text"), str):
            text = parsed["text"].strip()
            if text:
                return {
                    "text": parsed["text"],
                    "unified": None,
                    "correlationId": parsed.get("correlationId")
                    if isinstance(parsed.get("correlationId"), str)
                    else None,
                    "idempotencyKey": parsed.get("idempotencyKey")
                    if isinstance(parsed.get("idempotencyKey"), str)
                    else None,
                }
    except json.JSONDecodeError:
        pass

    return {"text": raw_payload, "unified": None}
