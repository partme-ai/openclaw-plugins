# OpenClaw Message SDK

**统一消息格式 SDK — openclaw-plugins 全渠道互通的消息标准与公共工具库**

[简体中文](./README.md) | [English](./README.en.md)

## 简介

`@partme.ai/openclaw-message-sdk` 是 openclaw-plugins 生态中的基础设施库，提供：

- **统一消息体（UnifiedMessage）** — 所有 IM 渠道插件共用的消息结构，支持跨渠道路由
- **媒体解析引擎** — 从 Markdown/HTML/MEDIA 指令/裸露路径中提取图片和文件
- **HTTP 客户端** — 带超时和指数退避重试的轻量 HTTP 封装
- **文件工具** — MIME/扩展名映射、文件分类
- **AI 能力模块** — ASR 语音识别、OCR 文字识别、TTS 语音合成（按需引入）

**零运行时必选依赖**。ASR/OCR/TTS 模块按需引入，不用的模块不会增加包体积。

### 核心设计原则

- **消息体不含二进制数据**，只包含文件 URL/路径引用
- **图片可选 base64** 内联（小图场景，<1MB）
- 内容类型支持 `text` / `markdown` / `mixed` 三种
- `traceId` 全链路追踪，贯穿消息生成 → 传输 → 投递
- 所有类型从主入口统一导入，也可按子路径按需导入

## 安装

```bash
npm install @partme.ai/openclaw-message-sdk
# or
pnpm add @partme.ai/openclaw-message-sdk
```

## 快速开始

```typescript
import {
  buildMessage,
  createImageRef,
  createMediaRef,
  serializeMessage,
  parseMessage,
  type UnifiedMessage,
} from "@partme.ai/openclaw-message-sdk";

// 1. 构造统一消息
const msg = buildMessage({
  channel: "wecom",
  accountId: "default",
  userId: "user_zhangsan",
  text: "请查看这张图片",
  media: [
    createImageRef("https://cdn.example.com/img.png", undefined, "report.png"),
    createMediaRef("https://cdn.example.com/data.pdf", "季度报告.pdf", 2048000),
  ],
});

// 2. 序列化为 JSON（MQ 跨渠道路由）
const json = serializeMessage(msg);

// 3. 反序列化（带校验）
const parsed = parseMessage(json);
if (parsed) {
  console.log(parsed.source.channel); // "wecom"
  console.log(parsed.traceId);        // "lj8xk-abc12345"
}
```

---

## 双路径 Dispatch（Wire vs Transcript）

| 路径 | SDK 入口 | 适用插件 |
|------|----------|----------|
| **Wire** | `dispatchWireMessage` / `bridge.dispatchInbound` | mqtt, rabbitmq, redis-stream, … |
| **Transcript** | `dispatchTranscriptTurn` | gotify, wecom, feishu |

```typescript
import {
  dispatchWireMessage,
  dispatchTranscriptTurn,
  createIdempotencyCache,
  normalizeWireIngress,
} from "@partme.ai/openclaw-message-sdk";

// MQ：Wire 路径（入站推荐 normalizeWireIngress + dispatchWireMessage）
const ingress = normalizeWireIngress({ rawPayload, mode: "jsonTextOrPlain", channel: "mqtt" });
if (!ingress.accepted) return;
await dispatchWireMessage({ runtime, channel: "mqtt", text: ingress.text, unified: ingress.unified, /* ... */ reply: { deliver } });

// IM：渠道插件先在本地解析平台事件，再走 Transcript 路径（保证 Control UI transcript）
await dispatchTranscriptTurn({ channelRuntime, cfg, channel: "gotify", /* ... */ delivery: { deliver } });
```

### deferred-delivery-ack（MQ 延迟 ACK）

RabbitMQ 等通道使用 `createDeferredDeliveryAck`：**reply publish 成功后再 ACK**，失败 nack/requeue。详见 [队列可靠性指南](../../doc/OpenClaw-Queue-Reliability-Guide.md)。

```typescript
import { createDeferredDeliveryAck } from "@partme.ai/openclaw-message-sdk/bridge";

const deferredAck = createDeferredDeliveryAck({
  delivery: brokerDelivery,
  requireReply: true,
  requeueOnMissingReply: true,
});
await dispatchChannelMessage({
  reply: { deliver: deferredAck.wrapReplyDeliver(publishReply) },
});
deferredAck.finalizeAfterDispatch();
```

### 幂等去重（createIdempotencyCache）

推荐所有通道插件使用 SDK 导出的 `createIdempotencyCache`，勿自建 `Map`：

```typescript
import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";

const dedup = createIdempotencyCache({ ttlMs: 60_000, maxEntries: 5000 });
const key = `${accountId}:${messageId}`;
if (dedup.has(key)) return;
// ... 成功处理后再 dedup.remember(key)
```

Gotify reference 实现见 `@partme.ai/openclaw-gotify` 的 `channel.ts`。

---

## API 参考

### 1. 统一消息体（UnifiedMessage）

```typescript
interface UnifiedMessage {
  messageId: string;           // 消息唯一 ID，格式: {channel}-{ts36}-{random6}
  traceId: string;             // 全链路追踪 ID，格式: {ts36}-{random8}
  timestamp: number;           // Unix 毫秒时间戳
  source: {
    channel: string;           // 来源渠道 (wecom, dingtalk, feishu...)
    accountId: string;         // 账号标识
    userId: string;            // 用户标识
    chatType: "direct" | "group";
  };
  target?: {
    channels: string[];        // 目标渠道列表
    routingRule?: string;      // 路由规则名
  };
  contentType: "text" | "markdown" | "mixed";
  text: string;                // 纯文本内容（所有渠道通用）
  markdown?: string;           // Markdown 内容（Markdown 渠道优先取用）
  media: MediaReference[];     // 媒体引用列表
  replyToMessageId?: string;   // 被回复消息的 ID
  metadata?: Record<string, unknown>; // 扩展元数据
  direction: "inbound" | "outbound";
}
```

**消息构造器**

| 函数 | 说明 |
|------|------|
| `buildMessage(params)` | 通用构造器，自动判定 `contentType` |
| `buildTextMessage(channel, accountId, userId, text, chatType?)` | 快捷纯文本消息 |
| `buildMediaMessage(channel, accountId, userId, text, media, chatType?)` | 快捷媒体消息 |

**序列化**

| 函数 | 说明 |
|------|------|
| `serializeMessage(msg)` | 序列化为 JSON 字符串 |
| `deserializeMessage(json)` | 反序列化（无校验） |
| `parseMessage(input)` | 安全反序列化，含基本字段校验，失败返回 `null` |
| `parseMessageAny(input)` | 从 `string/Buffer/Uint8Array/object` 解析，自动检测格式 |

**文本提取** — 从 UnifiedMessage 提取文本供不同能力等级的渠道使用：

| 函数 | 说明 |
|------|------|
| `extractPlainText(msg)` | 纯文本提取，Markdown 降级为纯文本，媒体替换为 `[图片]` 占位符 |
| `extractMarkdown(msg)` | Markdown 提取，媒体替换为 `![name](url)` 或 📎 链接 |
| `parseMediaFromText(text)` | 从文本中解析媒体引用（Markdown 图片 / MEDIA: / 裸露 URL） |

**ID 生成**

```typescript
const traceId = generateTraceId();           // "lj8xk-abc12345"
const msgId = generateMessageId("wecom");    // "wecom-lj8xk-x7y9z1"
```

---

### 2. 媒体引用（MediaReference）

```typescript
interface MediaReference {
  url: string;
  kind: "image" | "video" | "audio" | "document" | "archive" | "other";
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;          // 文件大小（字节）
  base64?: string;             // 小图可内联 base64
  thumbnailUrl?: string;
  durationSeconds?: number;    // 音视频时长
  width?: number;
  height?: number;
}
```

**构造器**

```typescript
// 通用媒体引用，自动检测 kind
const ref = createMediaRef("https://cdn.example.com/data.pdf", "report.pdf", 2048000);

// 图片专用（允许 base64 内联）
const img = createImageRef("https://cdn.example.com/img.png", undefined, "photo.png");
```

**类型检测**

```typescript
detectMediaKind("report.pdf");         // "document"
detectMediaKind("photo.jpg");          // "image"
detectMediaKind("song.mp3");           // "audio"
detectMediaKind("archive.zip");        // "archive"
detectMediaKindFromMime("image/webp"); // "image"
```

**预定义扩展名集合**

```typescript
IMAGE_EXTENSIONS    // Set: png, jpg, jpeg, gif, webp, bmp, svg, ico, tiff, heic, heif
VIDEO_EXTENSIONS    // Set: mp4, mov, avi, mkv, webm, flv, wmv, m4v
AUDIO_EXTENSIONS    // Set: mp3, wav, ogg, m4a, amr, flac, aac, opus, wma
DOCUMENT_EXTENSIONS // Set: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, md, rtf, odt, ods
ARCHIVE_EXTENSIONS  // Set: zip, rar, 7z, tar, gz, tgz, bz2
```

---

### 3. 媒体解析引擎（media-parser）

从 AI 回复文本中提取媒体引用，是渠道插件处理 `MEDIA:` 指令和 Markdown 图片的核心工具。

```typescript
import { extractMediaFromText } from "@partme.ai/openclaw-message-sdk";

const result = extractMediaFromText(
  "这是处理后的图片 ![](/tmp/photo.png)\n\n另外这个 PDF: [下载报告](/tmp/report.pdf)",
  {
    removeFromText: true,    // 提取后从文本中移除媒体引用
    checkExists: true,       // 仅提取磁盘上确实存在的文件
    parseMediaLines: true,   // 解析 MEDIA: 指令行
    parseMarkdownImages: true,
    parseHtmlImages: true,
    parseBarePaths: true,    // 裸露路径: /tmp/abc.png
    parseMarkdownLinks: true, // Markdown 文件链接
  }
);

// result.images  → [{ source: "/tmp/photo.png", type: "image", ... }]
// result.files   → [{ source: "/tmp/report.pdf", type: "file", ... }]
// result.all     → [...images, ...files]
// result.text    → 移除媒体后的纯文本
```

**便捷函数**

```typescript
// 仅提取图片
const { text, images } = extractImagesFromText(text, options);

// 仅提取文件
const { text, files } = extractFilesFromText(text, options);
```

**导出的路径工具**

```typescript
import {
  isHttpUrl,           // (value: string) => boolean
  isLocalReference,    // 检测是否为本地路径引用
  normalizeLocalPath,  // 标准化本地路径：MEDIA:/~/file:// → 绝对路径
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

### 4. HTTP 客户端

```typescript
import { httpPost, httpGet, withRetry, HttpError, TimeoutError } from "@partme.ai/openclaw-message-sdk";

// POST JSON，默认 30s 超时
const data = await httpPost<{ token: string }>(
  "https://api.example.com/auth",
  { appId: "xxx", secret: "yyy" }
);

// GET JSON
const users = await httpGet<{ id: string; name: string }[]>(
  "https://api.example.com/users",
  { headers: { Authorization: "Bearer token" } }
);

// 带重试（指数退避）
const result = await withRetry(
  () => fetchUnstableApi(),
  {
    maxRetries: 5,
    initialDelay: 500,     // 起始 500ms
    maxDelay: 10000,        // 上限 10s
    backoffMultiplier: 2,   // 每次翻倍: 500 → 1000 → 2000 → 4000 → 8000
    shouldRetry: (err, attempt) => {
      // 默认：网络错误 + 5xx 状态码
      return defaultShouldRetry(err) && attempt <= 3;
    },
  }
);
```

---

### 5. 文件工具（file-utils）

```typescript
import { resolveFileCategory, resolveExtension } from "@partme.ai/openclaw-message-sdk";

// MIME + 文件名 → 分类
resolveFileCategory("image/png");                     // "image"
resolveFileCategory("application/pdf", "report.pdf"); // "document"
resolveFileCategory("application/zip");               // "archive"

// MIME / 文件名 → 扩展名
resolveExtension("image/png");                        // ".png"
resolveExtension("application/zip", "backup.zip");    // ".zip"
```

---

### 6. ASR — 语音识别

```typescript
import { 
  transcribeTencentFlash,  // 腾讯云 Flash ASR（极速版）
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
// → { text: "今天天气真好", elapsedMs: 230 }
```

**错误层级**

```
ASRError (基类)
├── ASRAuthError        — 鉴权失败
├── ASRRequestError     — 请求失败
├── ASRResponseParseError — 响应解析失败
├── ASRServiceError     — 服务端错误
├── ASRTimeoutError     — 超时
└── ASREmptyResultError — 识别结果为空
```

---

### 7. OCR — 光学字符识别

支持 4 个提供商，统一接口：

```typescript
import {
  recognizeDeepSeek,     // DeepSeek Vision (deepseek-chat)
  recognizeGLM,          // 智谱 AI GLM-4V
  recognizePaddleOCR,    // 百度 PP-OCRv4 (自部署)
  recognizeQianfan,      // 百度千帆 ERNIE-4.0
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
// result.text           → 完整识别文本
// result.blocks[].lines[].words[].text  → 逐词识别结果
// result.provider       → "deepseek"
// result.elapsedMs      → 1234
```

**OCR 类型**

```typescript
interface OCRResult {
  text: string;           // 完整文本
  blocks: OCRBlock[];     // 块 → 行 → 词 层级
  provider: string;
  model: string;
  elapsedMs: number;
  imageSize?: { width: number; height: number };
}
```

---

### 8. TTS — 文本转语音

**远程方案**（纯 HTTP，零依赖）：

```typescript
import { synthesizeEdgeTTS, synthesizeOpenAI, EDGE_TTS_VOICES } from "@partme.ai/openclaw-message-sdk";

// Microsoft Edge TTS（免费，300+ 神经语音）
const result = await synthesizeEdgeTTS("你好，我是AI助手", {
  voice: "zh-CN-XiaoxiaoNeural",
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

**本地方案**（需要 Python 运行时，通过 child_process 调用）：

| 提供商 | 特点 |
|--------|------|
| `CHAT_TTS_PROVIDER` | 2noise/ChatTTS，自然对话风格 |
| `MARS5_TTS_PROVIDER` | CAMB.AI，语音克隆（5s 参考音频） |
| `QWEN_TTS_PROVIDER` | 阿里 Qwen3-TTS，声音设计 |
| `PYTTSX3_PROVIDER` | 完全离线，系统语音引擎 |

---

### 9. 错误类型

```typescript
import {
  MessageParseError,    // 消息解析失败（基类：Error）
  HttpError,            // HTTP 请求错误（status + body）
  TimeoutError,         // 请求超时（timeoutMs）
  // ASR 错误（见 §6）
  // OCR 错误（ocr/errors.ts）
  // TTS 错误（tts/errors.ts）
} from "@partme.ai/openclaw-message-sdk";
```

---

## 子路径导入

可按需导入，避免加载用不到的模块：

```typescript
// 仅媒体解析
import { extractMediaFromText } from "@partme.ai/openclaw-message-sdk/media";

// 仅 HTTP 客户端
import { httpPost, withRetry } from "@partme.ai/openclaw-message-sdk/http";

// 仅 ASR
import { transcribeTencentFlash } from "@partme.ai/openclaw-message-sdk/asr";

// 仅文件工具
import { resolveFileCategory } from "@partme.ai/openclaw-message-sdk/file";
```

---

## 在渠道插件中使用

各渠道插件（wecom, dingtalk, feishu, gotify, mqtt 等）使用 SDK 的标准模式：

```typescript
import { buildMessage, extractMediaFromText } from "@partme.ai/openclaw-message-sdk";

// 1. 入站：提取 AI 回复中的媒体指令
const { text, images, files } = extractMediaFromText(aiReply, {
  removeFromText: true,
  parseMediaLines: true,
  parseMarkdownImages: true,
  parseBarePaths: true,
});

// 2. 出站：构造统一消息体用于 MQ 路由
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

## 扩展指南

### 添加新的 ASR 提供商

```
src/asr/
├── index.ts          ← export 新函数
├── errors.ts         ← 共用错误类型
└── my-provider.ts    ← 实现 transcribeMyProvider()
```

```typescript
// my-provider.ts
import { ASRError, ASRAuthError } from "./errors.js";

export async function transcribeMyProvider(
  audio: Buffer, fileName: string, config: MyConfig
): Promise<{ text: string; elapsedMs: number }> {
  // 实现识别逻辑
}
```

### 添加新的 OCR 提供商

模式同上：实现 `recognizeXxx(input: OCRInput, config: OCRConfig): Promise<OCRResult>`。

### 添加新的 TTS 提供商

实现 `synthesizeXxx(text: string, config: TTSConfig): Promise<TTSResult>`。
