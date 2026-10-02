# Structured wire v1

O3 adds an explicit `structured-v1` format. Existing `envelope`, `legacyJsonText` and `plainText` defaults and encoders are unchanged. It is never enabled by guessing a target's capabilities.

```json
{"schemaVersion":1,"messageId":"m1","deliveryId":"d1","parts":[{"type":"text","text":"before"},{"type":"media","mediaType":"image","url":"https://media.example.org/image.png"},{"type":"text","text":"after"}],"replyTo":"parent","threadId":"thread"}
```

The ordered `parts` list permits text and media interleaving. Media types are `image`, `video`, `audio`, `document`, `archive`, `other`. IDs are nonempty strings up to 1024 characters; the list has 1–1024 parts, at most 8 media references, and at most 1 MiB aggregate UTF-8 text/URL bytes. Unknown versions, malformed parts and unsafe URLs fail explicitly. SDK decoding requires `parseTransportPayload(wire, "structured-v1")`; default legacy parsing remains unchanged.

Outbound media requires exact `structuredMediaHosts` (MQTT) or `structured.allowedMediaHosts` (Router), canonical HTTPS, no credentials/query/fragment, and the host's `loadWebMediaRaw` authorization/loading checks with an 8 MiB cap. The host's public-network DNS/redirect restrictions remain active; a configured hostname does not authorize private-network access. Local paths are rejected; this protocol does not publish local files. SDK callers must call `authorizeStructuredMedia` and pass its returned exact references as `authorizedMediaUrls` to the serializer. Never populate that argument from untrusted input.

Router opt-in configuration:

```json
{
  "structured": {"enabled": true, "allowedMediaHosts": ["media.example.org"]},
  "rules": [{"id":"media-route","match":{"channels":["mqtt"],"direction":"inbound"},"actions":[{"type":"forward","target":"wecom","topic":"user:recipient","payloadFormat":"structured-v1"}]}]
}
```

A declared target must actually expose `sendPayload`, or the required `sendText`/`sendMedia` methods. Router checks the entire set of needed methods and authorizes every attachment before the first part is sent. Undeclared media targets fail through existing retry/DLQ. Explicit `mediaFallback: "text"` discards media, preserves text order joined with newline and records `mediaFallback: "text"` in delivery audit. Configuration rejects this fallback when auditing is disabled.

Router persists the structured message in its existing version-1 Outbox; old tasks remain readable. `messageId`/`deliveryId` survive in the structured payload. A route-specific dedupe identity is used as the physical `deliveryQueueId`, with stable part index/count on retries. `replyToId` and `threadId` are passed to the channel's public context; actual provider support is channel-dependent. The original wire IDs are also supplied in `sendPayload` channelData. The public `sendText`/`sendMedia` interface does not carry arbitrary original wire metadata to the provider.

Delivery remains at least once: failure after an earlier part succeeds retries from part zero and may duplicate the prefix. No partial-send cursor or provider exactly-once guarantee is added. Some adapters, including WeCom, internally catch media upload errors and return a successful text-link fallback. Router cannot infer that internal downgrade from their return type. A successful Router settlement alone is not proof of attachment delivery; the installation fixture verifies actual uploaded bytes and an image message.

| Consumer | Default unchanged | Explicit structured-v1 |
| --- | --- | --- |
| SDK plain/legacy/envelope | Yes | Call explicit parser/serializer |
| MQTT | Envelope at dispatch unless existing option changes it | `payload.outboundFormat`, optional `payload.structuredMediaHosts` |
| Router | Existing text route behavior | `structured.enabled` + per-target `payloadFormat` |
| Other MQ channels | Yes | Not exposed by their configuration in O3 |
| Text-only target | Yes | Media rejected, or explicit audited text fallback |

Installation fixture: `OPENCLAW_E2E_STRUCTURED_WIRE=1` with `mqtt,router,wecom,gotify`. A real MQTT publish passes through the installed stable host's Router and WeCom adapter to a local WeCom OpenAPI fixture. The media source is pinned to repository commit `357bb9e871ad532a9401c42de619f7756f1cebc7`, `doc/qqbot/images/approve.png`, SHA256 `2e482e7c603d87edd0411414466f0f84d02c5055741a5a507b54f54a9c026851`. Public HTTPS download requires network access. No real WeCom credentials or public WeCom messages are used.

On development networks that synthesize a special-use DNS address for GitHub, the additional test flag `OPENCLAW_E2E_STRUCTURED_DNS_PIN=1` enables a Gateway-child-only preload mapping exactly `raw.githubusercontent.com` to the verified public address `185.199.108.133`. It retains the original HTTPS hostname, TLS/SNI validation and host SSRF enforcement; other DNS calls use the original resolver. Both O3 flags must be enabled. This fixture does not alter production code or system DNS. With the pin disabled, the host correctly rejects the synthetic `198.18.1.20` result.
