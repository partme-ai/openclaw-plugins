// Package openclaw provides a lightweight OpenClaw queue message envelope SDK.
package openclaw

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// MediaKind classifies attachment types.
type MediaKind string

const (
	MediaImage    MediaKind = "image"
	MediaVideo    MediaKind = "video"
	MediaAudio    MediaKind = "audio"
	MediaDocument MediaKind = "document"
	MediaArchive  MediaKind = "archive"
	MediaOther    MediaKind = "other"
)

// MessageContentType describes message body shape.
type MessageContentType string

const (
	ContentText     MessageContentType = "text"
	ContentMarkdown MessageContentType = "markdown"
	ContentMixed    MessageContentType = "mixed"
)

// MessageDirection is inbound or outbound.
type MessageDirection string

const (
	DirectionInbound  MessageDirection = "inbound"
	DirectionOutbound MessageDirection = "outbound"
)

// PayloadParseMode controls inbound parsing behavior.
type PayloadParseMode string

const (
	ParsePlain           PayloadParseMode = "plain"
	ParseJSONTextOrPlain PayloadParseMode = "jsonTextOrPlain"
	ParseJSONOnly        PayloadParseMode = "jsonOnly"
)

// OutboundWireFormat selects reply serialization shape.
type OutboundWireFormat string

const (
	FormatEnvelope      OutboundWireFormat = "envelope"
	FormatLegacyJSONText OutboundWireFormat = "legacyJsonText"
	FormatPlainText     OutboundWireFormat = "plainText"
)

// MediaReference is a structured media attachment.
type MediaReference struct {
	URL              string    `json:"url"`
	Kind             MediaKind `json:"kind"`
	MimeType         string    `json:"mimeType"`
	FileName         string    `json:"fileName,omitempty"`
	SizeBytes        int64     `json:"sizeBytes,omitempty"`
	Base64           string    `json:"base64,omitempty"`
	ThumbnailURL     string    `json:"thumbnailUrl,omitempty"`
	DurationSeconds  float64   `json:"durationSeconds,omitempty"`
	Width            int       `json:"width,omitempty"`
	Height           int       `json:"height,omitempty"`
}

// UnifiedMessageSource identifies message origin.
type UnifiedMessageSource struct {
	Channel   string `json:"channel"`
	AccountID string `json:"accountId"`
	UserID    string `json:"userId"`
	ChatType  string `json:"chatType"`
	AgentID   string `json:"agentId,omitempty"`
}

// UnifiedMessageTarget describes routing targets.
type UnifiedMessageTarget struct {
	Channels    []string `json:"channels,omitempty"`
	RoutingRule string   `json:"routingRule,omitempty"`
}

// UnifiedMessage is the legacy wire message body.
type UnifiedMessage struct {
	MessageID        string                `json:"messageId"`
	TraceID          string                `json:"traceId"`
	Timestamp        int64                 `json:"timestamp"`
	Source           UnifiedMessageSource  `json:"source"`
	Target           *UnifiedMessageTarget `json:"target,omitempty"`
	ContentType      MessageContentType    `json:"contentType"`
	Text             string                `json:"text"`
	Markdown         string                `json:"markdown,omitempty"`
	Media            []MediaReference      `json:"media"`
	ReplyToMessageID string                `json:"replyToMessageId,omitempty"`
	Metadata         map[string]any        `json:"metadata,omitempty"`
	Direction        MessageDirection      `json:"direction"`
}

// ReplyRoute carries outbound publish routing hints.
type ReplyRoute map[string]string

// MessageEnvelopeHeaders holds transport metadata.
type MessageEnvelopeHeaders struct {
	CorrelationID  string     `json:"correlationId,omitempty"`
	IdempotencyKey string     `json:"idempotencyKey,omitempty"`
	ReplyRoute     ReplyRoute `json:"replyRoute,omitempty"`
	Encoding       string     `json:"encoding,omitempty"`
}

// MessageEnvelope is version-1 wire transport envelope.
type MessageEnvelope struct {
	Version string                  `json:"version"`
	Message UnifiedMessage          `json:"message"`
	Headers *MessageEnvelopeHeaders `json:"headers,omitempty"`
}

// ParsedTransportPayload is the normalized parse result.
type ParsedTransportPayload struct {
	Text           string
	Unified        *UnifiedMessage
	CorrelationID  string
	IdempotencyKey string
	ReplyRoute     ReplyRoute
}

// BuildMessageParams configures BuildMessage.
type BuildMessageParams struct {
	Channel          string
	AccountID        string
	UserID           string
	AgentID          string
	ChatType         string
	Text             string
	Markdown         string
	Media            []MediaReference
	ReplyToMessageID string
	Metadata         map[string]any
	Direction        MessageDirection
}

// SerializeOutboundParams configures SerializeForTransport.
type SerializeOutboundParams struct {
	Channel    string
	AccountID  string
	UserID     string
	Text       string
	AgentID    string
	Format     OutboundWireFormat
	Headers    *MessageEnvelopeHeaders
	ReplyRoute ReplyRoute
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// GenerateTraceID returns a trace id.
func GenerateTraceID() string {
	return fmt.Sprintf("%x-%s", time.Now().UnixMilli(), randomHex(4))
}

// GenerateMessageID returns a message id with optional channel prefix.
func GenerateMessageID(channel string) string {
	prefix := channel
	if prefix != "" {
		prefix += "-"
	}
	return fmt.Sprintf("%s%x-%s", prefix, time.Now().UnixMilli(), randomHex(3))
}

// GenerateCorrelationID returns a correlation id.
func GenerateCorrelationID(prefix string) string {
	if prefix == "" {
		prefix = "corr"
	}
	return fmt.Sprintf("%s-%x-%s", prefix, time.Now().UnixMilli(), randomHex(3))
}

// BuildMessage constructs a UnifiedMessage.
func BuildMessage(p BuildMessageParams) UnifiedMessage {
	chatType := p.ChatType
	if chatType == "" {
		chatType = "direct"
	}
	contentType := ContentText
	hasMedia := len(p.Media) > 0
	hasText := strings.TrimSpace(p.Text) != ""
	hasMarkdown := strings.TrimSpace(p.Markdown) != ""
	if hasMedia && (hasText || hasMarkdown) {
		contentType = ContentMixed
	} else if hasMarkdown {
		contentType = ContentMarkdown
	}
	direction := p.Direction
	if direction == "" {
		direction = DirectionInbound
	}
	media := p.Media
	if media == nil {
		media = []MediaReference{}
	}
	msg := UnifiedMessage{
		MessageID:   GenerateMessageID(p.Channel),
		TraceID:     GenerateTraceID(),
		Timestamp:   time.Now().UnixMilli(),
		ContentType: contentType,
		Text:        p.Text,
		Markdown:    p.Markdown,
		Media:       media,
		Metadata:    p.Metadata,
		Direction:   direction,
		Source: UnifiedMessageSource{
			Channel:   p.Channel,
			AccountID: p.AccountID,
			UserID:    p.UserID,
			ChatType:  chatType,
			AgentID:   p.AgentID,
		},
	}
	if p.ReplyToMessageID != "" {
		msg.ReplyToMessageID = p.ReplyToMessageID
	}
	return msg
}

// ParseMessage parses UnifiedMessage JSON with validation.
func ParseMessage(raw []byte) (*UnifiedMessage, error) {
	var msg UnifiedMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return nil, err
	}
	if msg.MessageID == "" || msg.Source.Channel == "" {
		return nil, fmt.Errorf("invalid unified message")
	}
	return &msg, nil
}

// BuildEnvelope wraps UnifiedMessage in version-1 envelope.
func BuildEnvelope(message UnifiedMessage, headers *MessageEnvelopeHeaders) MessageEnvelope {
	env := MessageEnvelope{Version: "1", Message: message}
	if headers != nil {
		env.Headers = headers
	}
	return env
}

// BuildOutboundEnvelope builds direction=outbound envelope.
func BuildOutboundEnvelope(channel, accountID, userID, text, agentID string, headers *MessageEnvelopeHeaders) MessageEnvelope {
	msg := BuildMessage(BuildMessageParams{
		Channel:   channel,
		AccountID: accountID,
		UserID:    userID,
		AgentID:   agentID,
		Text:      text,
		Direction: DirectionOutbound,
	})
	return BuildEnvelope(msg, headers)
}

// ParseEnvelope parses MessageEnvelope from JSON bytes.
func ParseEnvelope(raw []byte) (*MessageEnvelope, error) {
	var env MessageEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, err
	}
	if env.Version == "1" && env.Message.MessageID != "" && env.Message.Source.Channel != "" {
		return &env, nil
	}
	msg, err := ParseMessage(raw)
	if err != nil || msg == nil {
		return nil, fmt.Errorf("invalid envelope")
	}
	return &MessageEnvelope{Version: "1", Message: *msg}, nil
}

// SerializeEnvelope serializes envelope to JSON string.
func SerializeEnvelope(env MessageEnvelope) (string, error) {
	b, err := json.Marshal(env)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// GetReplyRoute reads reply route from envelope headers.
func GetReplyRoute(env MessageEnvelope) ReplyRoute {
	if env.Headers == nil {
		return nil
	}
	return env.Headers.ReplyRoute
}

func metaString(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	v, ok := meta[key].(string)
	if !ok {
		return ""
	}
	return v
}

// ParseTransportPayload normalizes inbound wire payloads.
func ParseTransportPayload(raw []byte, mode PayloadParseMode) ParsedTransportPayload {
	if mode == ParsePlain {
		return ParsedTransportPayload{Text: string(raw)}
	}

	if env, err := ParseEnvelope(raw); err == nil && env.Message.Text != "" {
		meta := env.Message.Metadata
		corr := ""
		idem := ""
		if env.Headers != nil {
			corr = env.Headers.CorrelationID
			idem = env.Headers.IdempotencyKey
		}
		if corr == "" {
			corr = metaString(meta, "correlationId")
		}
		if idem == "" {
			idem = metaString(meta, "idempotencyKey")
		}
		var route ReplyRoute
		if env.Headers != nil {
			route = env.Headers.ReplyRoute
		}
		msg := env.Message
		return ParsedTransportPayload{
			Text:           msg.Text,
			Unified:        &msg,
			CorrelationID:  corr,
			IdempotencyKey: idem,
			ReplyRoute:     route,
		}
	}

	if msg, err := ParseMessage(raw); err == nil && msg.Text != "" {
		meta := msg.Metadata
		return ParsedTransportPayload{
			Text:           msg.Text,
			Unified:        msg,
			CorrelationID:  metaString(meta, "correlationId"),
			IdempotencyKey: metaString(meta, "idempotencyKey"),
		}
	}

	if mode == ParseJSONOnly {
		return ParsedTransportPayload{}
	}

	var legacy struct {
		Text           string `json:"text"`
		CorrelationID  string `json:"correlationId"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := json.Unmarshal(raw, &legacy); err == nil && strings.TrimSpace(legacy.Text) != "" {
		return ParsedTransportPayload{
			Text:           legacy.Text,
			CorrelationID:  legacy.CorrelationID,
			IdempotencyKey: legacy.IdempotencyKey,
		}
	}

	return ParsedTransportPayload{Text: string(raw)}
}

// SerializeForTransport serializes outbound reply text.
func SerializeForTransport(p SerializeOutboundParams) (string, error) {
	format := p.Format
	if format == "" {
		format = FormatEnvelope
	}
	switch format {
	case FormatPlainText:
		return p.Text, nil
	case FormatLegacyJSONText:
		b, err := json.Marshal(map[string]string{"text": p.Text})
		return string(b), err
	default:
		headers := p.Headers
		if headers == nil {
			headers = &MessageEnvelopeHeaders{}
		}
		if len(p.ReplyRoute) > 0 {
			headers.ReplyRoute = p.ReplyRoute
		}
		env := BuildOutboundEnvelope(p.Channel, p.AccountID, p.UserID, p.Text, p.AgentID, headers)
		return SerializeEnvelope(env)
	}
}
