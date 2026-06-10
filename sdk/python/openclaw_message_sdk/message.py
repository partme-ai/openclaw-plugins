"""UnifiedMessage construction, parsing, and ID helpers."""

from __future__ import annotations

import json
import random
import string
import time
from typing import Any

from openclaw_message_sdk.types import BuildMessageParams, MessageContentType, UnifiedMessage


def _random_suffix(length: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def generate_trace_id() -> str:
    """Generate trace id (timestamp + random)."""
    ts = format(int(time.time() * 1000), "x")
    return f"{ts}-{_random_suffix(8)}"


def generate_message_id(channel: str | None = None) -> str:
    """Generate message id with optional channel prefix."""
    prefix = f"{channel}-" if channel else ""
    ts = format(int(time.time() * 1000), "x")
    return f"{prefix}{ts}-{_random_suffix(6)}"


def generate_correlation_id(prefix: str = "corr") -> str:
    """Generate correlation id for request/reply pairing."""
    ts = format(int(time.time() * 1000), "x")
    return f"{prefix}-{ts}-{_random_suffix(6)}"


def parse_message(input_str: str) -> UnifiedMessage | None:
    """Parse UnifiedMessage from JSON string with validation."""
    try:
        obj = json.loads(input_str)
        if not isinstance(obj, dict):
            return None
        source = obj.get("source")
        if not isinstance(obj.get("messageId"), str):
            return None
        if not isinstance(source, dict) or not isinstance(source.get("channel"), str):
            return None
        if not isinstance(obj.get("text"), str):
            return None
        return obj  # type: ignore[return-value]
    except json.JSONDecodeError:
        return None


def parse_message_any(raw: str | bytes | bytearray | dict[str, Any]) -> UnifiedMessage | None:
    """Parse UnifiedMessage from string, bytes, or dict."""
    if isinstance(raw, (bytes, bytearray)):
        return parse_message(raw.decode("utf-8"))
    if isinstance(raw, str):
        return parse_message(raw)
    if isinstance(raw, dict):
        if isinstance(raw.get("message"), dict):
            return raw["message"]  # type: ignore[return-value]
        return raw  # type: ignore[return-value]
    return None


def build_message(params: BuildMessageParams) -> UnifiedMessage:
    """Build a UnifiedMessage from params."""
    media = params.get("media") or []
    text = params.get("text") or ""
    markdown = params.get("markdown")
    has_media = len(media) > 0
    has_text = bool(text)
    has_markdown = bool(markdown)

    content_type: MessageContentType = "text"
    if has_media and (has_text or has_markdown):
        content_type = "mixed"
    elif has_markdown:
        content_type = "markdown"

    channel = params["channel"]
    source: dict[str, Any] = {
        "channel": channel,
        "accountId": params["accountId"],
        "userId": params["userId"],
        "chatType": params.get("chatType", "direct"),
    }
    if params.get("agentId"):
        source["agentId"] = params["agentId"]

    msg: UnifiedMessage = {
        "messageId": generate_message_id(channel),
        "traceId": generate_trace_id(),
        "timestamp": int(time.time() * 1000),
        "source": source,  # type: ignore[typeddict-item]
        "contentType": content_type,
        "text": text,
        "media": media,
        "direction": params.get("direction", "inbound"),
    }
    if markdown:
        msg["markdown"] = markdown
    if params.get("replyToMessageId"):
        msg["replyToMessageId"] = params["replyToMessageId"]
    if params.get("metadata"):
        msg["metadata"] = params["metadata"]
    return msg


def serialize_message(msg: UnifiedMessage) -> str:
    """Serialize UnifiedMessage to JSON string."""
    return json.dumps(msg, ensure_ascii=False)
