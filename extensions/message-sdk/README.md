# OpenClaw Message SDK

> Unified Message Format SDK — cross-channel message standard and shared utility library for all openclaw-plugins channel plugins.

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--message--sdk-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-message-sdk)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## Overview

`@partme.ai/openclaw-message-sdk` is the foundational shared library for the openclaw-plugins ecosystem. It provides:

- **UnifiedMessage** — Common message structure shared by all IM channel plugins, supporting cross-channel routing
- **Media Parser Engine** — Extract images and files from Markdown/HTML/MEDIA directives/bare paths
- **HTTP Client** — Lightweight HTTP wrapper with timeout and exponential backoff retry
- **File Utilities** — MIME/extension mapping, file categorization
- **AI Capability Modules** — ASR speech recognition, OCR text recognition, TTS speech synthesis (optional imports)

**Zero mandatory runtime dependencies**. ASR/OCR/TTS modules are imported on demand — unused modules do not increase bundle size.

### Core Design Principles

- **No binary data in messages** — only file URL/path references
- **Optional base64 inlining** for small images (<1MB)
- Content type supports `text` / `markdown` / `mixed`
- `traceId` for end-to-end tracing throughout message generation, transmission, and delivery
- All types can be imported from the main entry, or via subpath imports for tree-shaking

## Installation

```bash
npm install @partme.ai/openclaw-message-sdk
# or
pnpm add @partme.ai/openclaw-message-sdk
```

## Quick Start

```typescript
import {
  buildMessage,
  createImageRef,
  createMediaRef,
  serializeMessage,
  parseMessage,
  type UnifiedMessage,
} from "@partme.ai/openclaw-message-sdk";

// 1. Build a unified message
const msg = buildMessage({
  channel: "wecom",
  accountId: "default",
  userId: "user_zhangsan",
  text: "Please review this image",
  media: [
    createImageRef("https://cdn.example.com/img.png", undefined, "report.png"),
    createMediaRef("https://cdn.example.com/data.pdf", "quarterly_report.pdf", 2048000),
  ],
});

// 2. Serialize to JSON (for MQ cross-channel routing)
const json = serializeMessage(msg);

// 3. Deserialize with validation
const parsed = parseMessage(json);
if (parsed) {
  console.log(parsed.source.channel); // "wecom"
  console.log(parsed.traceId);        // "lj8xk-abc12345"
}
```

---

## API Reference

### 1. UnifiedMessage

```typescript
interface UnifiedMessage {
  messageId: string;           // Unique message ID, format: {channel}-{ts36}-{random6}
  traceId: string;             // End-to-end tracing ID, format: {ts36}-{random8}
  timestamp: number;           // Unix timestamp in milliseconds
  source: {
    channel: string;           // Source channel (wecom, dingtalk, feishu...)
    accountId: string;         // Account identifier
    userId: string;            // User identifier
    chatType: "direct" | "group";
  };
  target?: {
    channels: string[];        // Target channel list
    routingRule?: string;      // Routing rule name
  };
  contentType: "text" | "markdown" | "mixed";
  text: string;                // Plain text (universal across all channels)
  markdown?: string;           // Markdown content (preferred by Markdown channels)
  media: MediaReference[];     // Media reference list
  replyToMessageId?: string;   // Original message being replied to
  metadata?: Record<string, unknown>; // Extended metadata
  direction: "inbound" | "outbound";
}
```

**Message Builders**

| Function | Description |
|----------|-------------|
| `buildMessage(params)` | General-purpose builder, auto-detects `contentType` |
| `buildTextMessage(channel, accountId, userId, text, chatType?)` | Quick plain text message |
| `buildMediaMessage(channel, accountId, userId, text, media, chatType?)` | Quick media message |

**Serialization**

| Function | Description |
|----------|-------------|
| `serializeMessage(msg)` | Serialize to JSON string |
| `deserializeMessage(json)` | Deserialize without validation |
| `parseMessage(input)` | Safe deserialization with basic field validation, returns `null` on failure |
| `parseMessageAny(input)` | Parse from `string/Buffer/Uint8Array/object`, auto-detects format |

**Text Extraction** — Extract text from UnifiedMessage for channels with different capability levels:

| Function | Description |
|----------|-------------|
| `extractPlainText(msg)` | Plain text extraction, Markdown downgraded to plain text, media replaced with `[image]` placeholders |
| `extractMarkdown(msg)` | Markdown extraction, media replaced with `![name](url)` or file links |
| `parseMediaFromText(text)` | Parse media references from text (Markdown images / MEDIA: directives / bare URLs) |

**ID Generation**

```typescript
const traceId = generateTraceId();           // "lj8xk-abc12345"
const msgId = generateMessageId("wecom");    // "wecom-lj8xk-x7y9z1"
```

---

### 2. MediaReference

```typescript
interface MediaReference {
  url: string;
  kind: "image" | "video" | "audio" | "document" | "archive" | "other";
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;          // File size in bytes
  base64?: string;             // Optional base64 for small images
  thumbnailUrl?: string;
  durationSeconds?: number;    // Audio/video duration
  width?: number;
  height?: number;
}
```

**Constructors**

```typescript
// Generic media reference, auto-detects kind
const ref = createMediaRef("https://cdn.example.com/data.pdf", "report.pdf", 2048000);

// Image-specific (supports base64 inlining)
const img = createImageRef("https://cdn.example.com/img.png", undefined, "photo.png");
```

**Type Detection**

```typescript
detectMediaKind("report.pdf");         // "document"
detectMediaKind("photo.jpg");          // "image"
detectMediaKind("song.mp3");           // "audio"
detectMediaKind("archive.zip");        // "archive"
detectMediaKindFromMime("image/webp"); // "image"
```

**Predefined Extension Sets**

```typescript
IMAGE_EXTENSIONS    // Set: png, jpg, jpeg, gif, webp, bmp, svg, ico, tiff, heic, heif
VIDEO_EXTENSIONS    // Set: mp4, mov, avi, mkv, webm, flv, wmv, m4v
AUDIO_EXTENSIONS    // Set: mp3, wav, ogg, m4a, amr, flac, aac, opus, wma
DOCUMENT_EXTENSIONS // Set: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, md, rtf, odt, ods
ARCHIVE_EXTENSIONS  // Set: zip, rar, 7z, tar, gz, tgz, bz2
```

---

### 3. Media Parser Engine

The core tool for channel plugins to extract media references from AI reply text. Supports `MEDIA:` directives, Markdown images, and bare paths.

```typescript
import { extractMediaFromText } from "@partme.ai/openclaw-message-sdk";

const result = extractMediaFromText(
  "Processed image: ![](/tmp/photo.png)\n\nPDF report: [download](/tmp/report.pdf)",
  {
    removeFromText: true,    // Remove media references from text after extraction
    checkExists: true,       // Only extract files that actually exist on disk
    parseMediaLines: true,   // Parse MEDIA: directive lines
    parseMarkdownImages: true,
    parseHtmlImages: true,
    parseBarePaths: true,    // Bare paths: /tmp/abc.png
    parseMarkdownLinks: true, // Markdown file links
  }
);

// result.images  → [{ source: "/tmp/photo.png", type: "image", ... }]
// result.files   → [{ source: "/tmp/report.pdf", type: "file", ... }]
// result.all     → [...images, ...files]
// result.text    → Clean text with media references removed
```

**Convenience Functions**

```typescript
// Extract images only
const { text, images } = extractImagesFromText(text, options);

// Extract files only
const { text, files } = extractFilesFromText(text, options);
```

**Exported Path Utilities**

```typescript
import {
  isHttpUrl,           // (value: string) => boolean
  isLocalReference,    // Check if a value is a local path reference
  normalizeLocalPath,  // Normalize local paths: MEDIA:/~/file:// → absolute path
  isImagePath,         // (path: string) => boolean
  isNonImageFilePath,  // (path: string) => boolean
  getExtension,        // (path: string) => string  (no dot)
  detectMediaTypeFromPath, // → "image" | "audio" | "video" | "file"
  type ExtractedMedia,
  type MediaParseResult,
  type MediaParseOptions,
} from "@partme.ai/openclaw-message-sdk";
```

---

### 4. HTTP Client

```typescript
import { httpPost, httpGet, withRetry, HttpError, TimeoutError } from "@partme.ai/openclaw-message-sdk";

// POST JSON, 30s timeout by default
const data = await httpPost<{ token: string }>(
  "https://api.example.com/auth",
  { appId: "xxx", secret: "yyy" }
);

// GET JSON
const users = await httpGet<{ id: string; name: string }[]>(
  "https://api.example.com/users",
  { headers: { Authorization: "Bearer token" } }
);

// With retry (exponential backoff)
const result = await withRetry(
  () => fetchUnstableApi(),
  {
    maxRetries: 5,
    initialDelay: 500,     // Start at 500ms
    maxDelay: 10000,        // Cap at 10s
    backoffMultiplier: 2,   // Double each time: 500 → 1000 → 2000 → 4000 → 8000
    shouldRetry: (err, attempt) => {
      // Default: network errors + 5xx status codes
      return defaultShouldRetry(err) && attempt <= 3;
    },
  }
);
```

---

### 5. File Utilities

```typescript
import { resolveFileCategory, resolveExtension } from "@partme.ai/openclaw-message-sdk";

// MIME + filename → category
resolveFileCategory("image/png");                     // "image"
resolveFileCategory("application/pdf", "report.pdf"); // "document"
resolveFileCategory("application/zip");               // "archive"

// MIME / filename → extension
resolveExtension("image/png");                        // ".png"
resolveExtension("application/zip", "backup.zip");    // ".zip"
```

---

### 6. ASR — Speech Recognition

```typescript
import { 
  transcribeTencentFlash,  // Tencent Cloud Flash ASR (real-time)
  ASRError,
  ASRTimeoutError,
  ASRAuthError,
  ASREmptyResultError,
  type TencentFlashASRConfig,
} from "@partme.ai/openclaw-message-sdk";

const config: TencentFlashASRConfig = {
  appId: "1300000000",
  secretId: "AKIDxxxx",
  secretKey: "xxxx",
};

const result = await transcribeTencentFlash(audioBuffer, "voice.amr", config);
// → { text: "Nice weather today", elapsedMs: 230 }
```

**Error Hierarchy**

```
ASRError (base)
├── ASRAuthError            — Authentication failure
├── ASRRequestError         — Request failure
├── ASRResponseParseError   — Response parsing failure
├── ASRServiceError         — Server-side error
├── ASRTimeoutError         — Timeout
└── ASREmptyResultError     — Empty recognition result
```

---

### 7. OCR — Optical Character Recognition

Supports 4 providers with a unified interface:

```typescript
import {
  recognizeDeepSeek,     // DeepSeek Vision (deepseek-chat)
  recognizeGLM,          // ZhipuAI GLM-4V
  recognizePaddleOCR,    // Baidu PP-OCRv4 (self-hosted)
  recognizeQianfan,      // Baidu Qianfan ERNIE-4.0
  type OCRInput,
  type OCRConfig,
  type OCRResult,
} from "@partme.ai/openclaw-message-sdk";

const config: OCRConfig = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY!,
  model: "deepseek-chat",
};

const input: OCRInput = {
  url: "https://cdn.example.com/receipt.png",
};

const result: OCRResult = await recognizeDeepSeek(input, config);
// result.text           → Full recognized text
// result.blocks[].lines[].words[].text  → Per-word recognition
// result.provider       → "deepseek"
// result.elapsedMs      → 1234
```

**OCR Types**

```typescript
interface OCRResult {
  text: string;           // Full text
  blocks: OCRBlock[];     // Block → Line → Word hierarchy
  provider: string;
  model: string;
  elapsedMs: number;
  imageSize?: { width: number; height: number };
}
```

---

### 8. TTS — Text-to-Speech

**Remote Solutions** (pure HTTP, zero additional dependencies):

```typescript
import { synthesizeEdgeTTS, synthesizeOpenAI, EDGE_TTS_VOICES } from "@partme.ai/openclaw-message-sdk";

// Microsoft Edge TTS (free, 300+ neural voices)
const result = await synthesizeEdgeTTS("Hello, I am an AI assistant", {
  voice: "en-US-JennyNeural",
  outputFormat: "mp3",
  rate: "+10%",
});
// result.audio   → Buffer (MP3)
// result.elapsedMs → 850

// OpenAI TTS
const result2 = await synthesizeOpenAI("Welcome to OpenClaw", {
  apiKey: process.env.OPENAI_API_KEY!,
  model: "tts-1",
  voice: "alloy",
});
```

**Local Solutions** (require Python runtime, called via child_process):

| Provider | Description |
|----------|-------------|
| `CHAT_TTS_PROVIDER` | 2noise/ChatTTS, natural conversation style |
| `MARS5_TTS_PROVIDER` | CAMB.AI, voice cloning (5s reference audio) |
| `QWEN_TTS_PROVIDER` | Alibaba Qwen3-TTS, voice design |
| `PYTTSX3_PROVIDER` | Fully offline, system speech engine |

---

### 9. Error Types

```typescript
import {
  MessageParseError,    // Message parsing failure (extends Error)
  HttpError,            // HTTP request error (status + body)
  TimeoutError,         // Request timeout (timeoutMs)
  // ASR errors (see section 6)
  // OCR errors (ocr/errors.ts)
  // TTS errors (tts/errors.ts)
} from "@partme.ai/openclaw-message-sdk";
```

---

## Subpath Imports

Import only what you need to avoid loading unused modules:

```typescript
// Media parser only
import { extractMediaFromText } from "@partme.ai/openclaw-message-sdk/media";

// HTTP client only
import { httpPost, withRetry } from "@partme.ai/openclaw-message-sdk/http";

// ASR only
import { transcribeTencentFlash } from "@partme.ai/openclaw-message-sdk/asr";

// File utilities only
import { resolveFileCategory } from "@partme.ai/openclaw-message-sdk/file";
```

---

## Usage in Channel Plugins

Channel plugins (wecom, dingtalk, feishu, gotify, mqtt, etc.) follow this standard pattern:

```typescript
import { buildMessage, extractMediaFromText } from "@partme.ai/openclaw-message-sdk";

// 1. Inbound: Extract media directives from AI replies
const { text, images, files } = extractMediaFromText(aiReply, {
  removeFromText: true,
  parseMediaLines: true,
  parseMarkdownImages: true,
  parseBarePaths: true,
});

// 2. Outbound: Build unified message for MQ routing
const outbound = buildMessage({
  channel: "wecom",
  accountId: account.accountId,
  userId: senderId,
  text: text,
  media: [
    ...images.map((img) => createImageRef(img.source, undefined, img.fileName)),
    ...files.map((f) => createMediaRef(f.source, f.fileName)),
  ],
});
```

---

## Extension Guide

### Adding a New ASR Provider

```
src/asr/
├── index.ts          ← Export the new function
├── errors.ts         ← Shared error types
└── my-provider.ts    ← Implement transcribeMyProvider()
```

```typescript
// my-provider.ts
import { ASRError, ASRAuthError } from "./errors.js";

export async function transcribeMyProvider(
  audio: Buffer, fileName: string, config: MyConfig
): Promise<{ text: string; elapsedMs: number }> {
  // Implement recognition logic
}
```

### Adding a New OCR Provider

Same pattern: implement `recognizeXxx(input: OCRInput, config: OCRConfig): Promise<OCRResult>`.

### Adding a New TTS Provider

Implement `synthesizeXxx(text: string, config: TTSConfig): Promise<TTSResult>`.

## Available Subpath Exports

| Subpath | Contents |
|---------|----------|
| `@partme.ai/openclaw-message-sdk` | Core types, message builders, serialization |
| `@partme.ai/openclaw-message-sdk/media` | Media parser and IO utilities |
| `@partme.ai/openclaw-message-sdk/http` | HTTP client with retry |
| `@partme.ai/openclaw-message-sdk/file` | File category/extension utilities |
| `@partme.ai/openclaw-message-sdk/asr` | Tencent Cloud Flash ASR |
| `@partme.ai/openclaw-message-sdk/ocr` | OCR with 4 providers |
| `@partme.ai/openclaw-message-sdk/tts` | TTS with Edge/openai/local providers |
| `@partme.ai/openclaw-message-sdk/util` | withTimeout, truncateUtf8Bytes, formatTemplate, globalSingleton |
| `@partme.ai/openclaw-message-sdk/transcript` | IM streaming config, finish-stream, reply dispatcher factory |
| `@partme.ai/openclaw-message-sdk/routing` | dynamic-peer-agent routing |
| `@partme.ai/openclaw-message-sdk/config` | mergeChannelAccountConfig |
| `@partme.ai/openclaw-message-sdk/queue` | keyed run queue, debounce buffer |

## License

Licensed under the [MIT License](LICENSE).

## About openclaw-plugins

This SDK is part of [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) — an enterprise OpenClaw plugin collection developed and maintained by the **PartMe.AI team**, featuring 30+ plugins across IM channels, message queues, AI capabilities, and infrastructure.

Each plugin is published independently on npm under the `@partme.ai` scope:

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

**PartMe.AI** specializes in AI customer service and enterprise AI agent infrastructure, providing end-to-end solutions from WeChat Work/DingTalk/Feishu/QQ channel integration to RAG knowledge bases, multi-layer memory, and production monitoring.

> Contact: partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

## Queue Message Format Guide

For queue plugin wire formats, adapter behavior, and cross-language SDK guidance, see [OpenClaw Queue Message Format Guide](../../doc/OpenClaw-Queue-Message-Format-Guide.en.md).
