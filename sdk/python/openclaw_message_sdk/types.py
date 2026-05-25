"""Core type aliases for OpenClaw message SDK."""

from __future__ import annotations

from typing import Any, Literal, TypedDict


MediaKind = Literal["image", "video", "audio", "document", "archive", "other"]
MessageContentType = Literal["text", "markdown", "mixed"]
MessageDirection = Literal["inbound", "outbound"]
PayloadParseMode = Literal["plain", "jsonTextOrPlain", "jsonOnly"]
OutboundWireFormat = Literal["envelope", "legacyJsonText", "plainText"]


class MediaReference(TypedDict, total=False):
    url: str
    kind: MediaKind
    mimeType: str
    fileName: str
    sizeBytes: int
    base64: str
    thumbnailUrl: str
    durationSeconds: float
    width: int
    height: int


class UnifiedMessageSource(TypedDict, total=False):
    channel: str
    accountId: str
    userId: str
    chatType: Literal["direct", "group"]
    agentId: str


class UnifiedMessageTarget(TypedDict, total=False):
    channels: list[str]
    routingRule: str


class UnifiedMessage(TypedDict, total=False):
    messageId: str
    traceId: str
    timestamp: int
    source: UnifiedMessageSource
    target: UnifiedMessageTarget
    contentType: MessageContentType
    text: str
    markdown: str
    media: list[MediaReference]
    replyToMessageId: str
    metadata: dict[str, Any]
    direction: MessageDirection


class ReplyRoute(TypedDict, total=False):
    topic: str
    routingKey: str
    exchange: str
    destination: str
    queue: str


class MessageEnvelopeHeaders(TypedDict, total=False):
    correlationId: str
    idempotencyKey: str
    replyRoute: ReplyRoute
    encoding: Literal["json", "plain"]


class MessageEnvelope(TypedDict, total=False):
    version: Literal["1"]
    message: UnifiedMessage
    headers: MessageEnvelopeHeaders


class ParsedTransportPayload(TypedDict, total=False):
    text: str
    unified: UnifiedMessage | None
    correlationId: str
    idempotencyKey: str
    replyRoute: ReplyRoute


class BuildMessageParams(TypedDict, total=False):
    channel: str
    accountId: str
    userId: str
    agentId: str
    chatType: Literal["direct", "group"]
    text: str
    markdown: str
    media: list[MediaReference]
    replyToMessageId: str
    metadata: dict[str, Any]
    direction: MessageDirection


class SerializeOutboundParams(TypedDict, total=False):
    channel: str
    accountId: str
    userId: str
    text: str
    agentId: str
    format: OutboundWireFormat
    headers: MessageEnvelopeHeaders
    replyRoute: ReplyRoute
