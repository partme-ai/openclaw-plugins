/**
 * message-sdk 核心类型、构造器、序列化、错误类 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  detectMediaKind,
  detectMediaKindFromMime,
  buildMessage,
  buildTextMessage,
  buildMediaMessage,
  serializeMessage,
  deserializeMessage,
  parseMessage,
  parseMessageAny,
  generateTraceId,
  generateMessageId,
  createMediaRef,
  createImageRef,
  extractPlainText,
  extractMarkdown,
  parseMediaFromText,
  FileSizeLimitError,
  MediaTimeoutError,
  MessageParseError,
  type UnifiedMessage,
  type MediaReference,
} from "./index.ts";

// ============================================================================
// detectMediaKind
// ============================================================================

describe("detectMediaKind", () => {
  it("识别图片扩展名", () => {
    expect(detectMediaKind("photo.png")).toBe("image");
    expect(detectMediaKind("img.JPG")).toBe("image");
    expect(detectMediaKind("logo.svg")).toBe("image");
    expect(detectMediaKind("scan.heic")).toBe("image");
  });

  it("识别视频扩展名", () => {
    expect(detectMediaKind("video.mp4")).toBe("video");
    expect(detectMediaKind("clip.mov")).toBe("video");
    expect(detectMediaKind("stream.webm")).toBe("video");
    expect(detectMediaKind("movie.mkv")).toBe("video");
  });

  it("识别音频扩展名", () => {
    expect(detectMediaKind("song.mp3")).toBe("audio");
    expect(detectMediaKind("recording.wav")).toBe("audio");
    expect(detectMediaKind("voice.ogg")).toBe("audio");
    expect(detectMediaKind("podcast.flac")).toBe("audio");
  });

  it("识别文档扩展名", () => {
    expect(detectMediaKind("report.pdf")).toBe("document");
    expect(detectMediaKind("sheet.xlsx")).toBe("document");
    expect(detectMediaKind("slides.pptx")).toBe("document");
    expect(detectMediaKind("notes.txt")).toBe("document");
  });

  it("识别压缩包扩展名", () => {
    expect(detectMediaKind("archive.zip")).toBe("archive");
    expect(detectMediaKind("bundle.tar.gz")).toBe("archive");
    expect(detectMediaKind("data.7z")).toBe("archive");
  });

  it("未知扩展名返回 other", () => {
    expect(detectMediaKind("file.xyz")).toBe("other");
    expect(detectMediaKind("script.ts")).toBe("other");
    expect(detectMediaKind("noextension")).toBe("other");
  });

  it("空字符串返回 other", () => {
    expect(detectMediaKind("")).toBe("other");
  });
});

// ============================================================================
// detectMediaKindFromMime
// ============================================================================

describe("detectMediaKindFromMime", () => {
  it("从 MIME 类型识别", () => {
    expect(detectMediaKindFromMime("image/png")).toBe("image");
    expect(detectMediaKindFromMime("video/mp4")).toBe("video");
    expect(detectMediaKindFromMime("audio/mpeg")).toBe("audio");
    expect(detectMediaKindFromMime("application/pdf")).toBe("document");
    expect(detectMediaKindFromMime("application/zip")).toBe("archive");
    expect(detectMediaKindFromMime("application/octet-stream")).toBe("other");
  });

  it("大小写不敏感", () => {
    expect(detectMediaKindFromMime("IMAGE/JPEG")).toBe("image");
    expect(detectMediaKindFromMime("Video/WebM")).toBe("video");
  });

  it("包含 application/msword 等", () => {
    expect(detectMediaKindFromMime("application/msword")).toBe("document");
    expect(detectMediaKindFromMime("application/vnd.ms-excel")).toBe("document");
    expect(detectMediaKindFromMime("application/vnd.ms-powerpoint")).toBe("document");
  });

  it("rar 相关 mime", () => {
    expect(detectMediaKindFromMime("application/x-rar-compressed")).toBe("archive");
    expect(detectMediaKindFromMime("application/gzip")).toBe("archive");
  });
});

// ============================================================================
// buildMessage
// ============================================================================

describe("buildMessage", () => {
  it("纯文本消息", () => {
    const msg = buildMessage({
      channel: "wecom",
      accountId: "acct-1",
      userId: "user-1",
      text: "你好",
    });
    expect(msg.contentType).toBe("text");
    expect(msg.text).toBe("你好");
    expect(msg.markdown).toBeUndefined();
    expect(msg.media).toEqual([]);
    expect(msg.source.channel).toBe("wecom");
    expect(msg.source.accountId).toBe("acct-1");
    expect(msg.source.userId).toBe("user-1");
    expect(msg.source.chatType).toBe("direct");
  });

  it("Markdown 消息", () => {
    const msg = buildMessage({
      channel: "dingtalk",
      accountId: "acct-1",
      userId: "user-1",
      markdown: "## 标题\n内容",
    });
    expect(msg.contentType).toBe("markdown");
    expect(msg.markdown).toBe("## 标题\n内容");
  });

  it("图文混合消息", () => {
    const msg = buildMessage({
      channel: "lark",
      accountId: "acct-1",
      userId: "user-1",
      text: "看这张图",
      media: [{ url: "https://example.com/img.png", kind: "image", mimeType: "image/png" }],
    });
    expect(msg.contentType).toBe("mixed");
    expect(msg.media).toHaveLength(1);
  });

  it("群聊消息", () => {
    const msg = buildMessage({
      channel: "wecom",
      accountId: "acct-1",
      userId: "user-1",
      text: "hello",
      chatType: "group",
    });
    expect(msg.source.chatType).toBe("group");
  });

  it("包含 messageId 和 traceId", () => {
    const msg = buildMessage({ channel: "wecom", accountId: "a", userId: "u", text: "t" });
    expect(msg.messageId).toBeTruthy();
    expect(msg.traceId).toBeTruthy();
    expect(msg.messageId).toContain("wecom-");
    expect(typeof msg.timestamp).toBe("number");
  });

  it("outbound 方向", () => {
    const msg = buildMessage({
      channel: "wecom", accountId: "a", userId: "u", text: "t", direction: "outbound",
    });
    expect(msg.direction).toBe("outbound");
  });

  it("包含 replyToMessageId", () => {
    const msg = buildMessage({
      channel: "wecom", accountId: "a", userId: "u", text: "回复",
      replyToMessageId: "msg-123",
    });
    expect(msg.replyToMessageId).toBe("msg-123");
  });

  it("包含 metadata", () => {
    const meta = { sessionKey: "s1", priority: 1 };
    const msg = buildMessage({
      channel: "wecom", accountId: "a", userId: "u", text: "t", metadata: meta,
    });
    expect(msg.metadata).toEqual(meta);
  });
});

// ============================================================================
// buildTextMessage / buildMediaMessage
// ============================================================================

describe("buildTextMessage / buildMediaMessage", () => {
  it("buildTextMessage 快捷构造", () => {
    const msg = buildTextMessage("lark", "acct", "user", "纯文本");
    expect(msg.contentType).toBe("text");
    expect(msg.text).toBe("纯文本");
    expect(msg.source.channel).toBe("lark");
  });

  it("buildMediaMessage 快捷构造", () => {
    const media: MediaReference[] = [
      { url: "https://img.com/pic.png", kind: "image", mimeType: "image/png" },
    ];
    const msg = buildMediaMessage("wecom", "acct", "user", "看图片", media);
    expect(msg.contentType).toBe("mixed");
    expect(msg.media).toEqual(media);
  });
});

// ============================================================================
// 序列化 / 反序列化
// ============================================================================

describe("serializeMessage / deserializeMessage", () => {
  it("往返一致", () => {
    const msg = buildTextMessage("wecom", "acct", "user", "你好世界");
    const json = serializeMessage(msg);
    const restored = deserializeMessage(json);
    expect(restored.messageId).toBe(msg.messageId);
    expect(restored.text).toBe(msg.text);
    expect(restored.source.channel).toBe(msg.source.channel);
  });
});

describe("parseMessage", () => {
  it("合法 JSON 返回消息对象", () => {
    const original = buildTextMessage("test", "a", "u", "hello");
    const parsed = parseMessage(serializeMessage(original));
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe("hello");
  });

  it("缺少 messageId 返回 null", () => {
    expect(parseMessage(JSON.stringify({ source: { channel: "x" }, text: "hi" }))).toBeNull();
  });

  it("缺少 source.channel 返回 null", () => {
    expect(parseMessage(JSON.stringify({ messageId: "m1", source: {}, text: "hi" }))).toBeNull();
  });

  it("text 不是 string 返回 null", () => {
    expect(parseMessage(JSON.stringify({ messageId: "m1", source: { channel: "x" }, text: 123 }))).toBeNull();
  });

  it("无效 JSON 返回 null", () => {
    expect(parseMessage("not json")).toBeNull();
  });

  it("null 输入返回 null", () => {
    expect(parseMessage("null")).toBeNull();
  });

  it("非对象 JSON 返回 null", () => {
    expect(parseMessage("123")).toBeNull();
    expect(parseMessage('"string"')).toBeNull();
    expect(parseMessage("[]")).toBeNull();
  });
});

describe("parseMessageAny", () => {
  it("string 输入", () => {
    const msg = buildTextMessage("test", "a", "u", "hello");
    expect(parseMessageAny(serializeMessage(msg))).not.toBeNull();
  });

  it("Buffer 输入", () => {
    const msg = buildTextMessage("test", "a", "u", "buffer test");
    const buf = Buffer.from(serializeMessage(msg), "utf-8");
    expect(parseMessageAny(buf)).not.toBeNull();
  });

  it("Uint8Array 输入", () => {
    const msg = buildTextMessage("test", "a", "u", "uint8 test");
    const arr = new TextEncoder().encode(serializeMessage(msg));
    expect(parseMessageAny(arr)).not.toBeNull();
  });

  it("对象直接返回", () => {
    const msg = buildTextMessage("test", "a", "u", "obj");
    expect(parseMessageAny(msg)).toBe(msg);
  });

  it("无效输入返回 null", () => {
    expect(parseMessageAny("bad json")).toBeNull();
    expect(parseMessageAny(123)).toBeNull();
    expect(parseMessageAny(undefined)).toBeNull();
  });
});

// ============================================================================
// generateTraceId / generateMessageId
// ============================================================================

describe("generateTraceId", () => {
  it("生成非空字符串", () => {
    const id = generateTraceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(5);
  });

  it("每次生成不同值", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });

  it("包含连字符", () => {
    expect(generateTraceId()).toContain("-");
  });
});

describe("generateMessageId", () => {
  it("带渠道前缀", () => {
    const id = generateMessageId("wecom");
    expect(id.startsWith("wecom-")).toBe(true);
  });

  it("无渠道时无前缀连字符", () => {
    const id = generateMessageId();
    expect(id).not.toContain("undefined");
    expect(id.length).toBeGreaterThan(3);
  });
});

// ============================================================================
// createMediaRef / createImageRef
// ============================================================================

describe("createMediaRef", () => {
  it("从 URL 创建基本引用", () => {
    const ref = createMediaRef("https://cdn.com/file.pdf", "report.pdf", 102400);
    expect(ref.url).toBe("https://cdn.com/file.pdf");
    expect(ref.kind).toBe("document");
    expect(ref.fileName).toBe("report.pdf");
    expect(ref.sizeBytes).toBe(102400);
    expect(ref.mimeType).toBe("application/octet-stream");
  });

  it("无文件名时从 URL 推断 kind", () => {
    const ref = createMediaRef("https://cdn.com/photo.png");
    expect(ref.kind).toBe("image");
  });
});

describe("createImageRef", () => {
  it("创建图片引用含 base64", () => {
    const ref = createImageRef("https://img.com/pic.png", "base64data==", "pic.png");
    expect(ref.kind).toBe("image");
    expect(ref.mimeType).toBe("image/png");
    expect(ref.base64).toBe("base64data==");
  });

  it("jpg 映射为 image/jpeg", () => {
    const ref = createImageRef("url", undefined, "photo.jpg");
    expect(ref.mimeType).toBe("image/jpeg");
  });

  it("默认扩展名为 png", () => {
    const ref = createImageRef("url");
    expect(ref.mimeType).toBe("image/png");
  });
});

// ============================================================================
// extractPlainText
// ============================================================================

describe("extractPlainText", () => {
  it("纯文本消息直出", () => {
    const msg = buildTextMessage("wecom", "a", "u", "你好世界");
    expect(extractPlainText(msg)).toBe("你好世界");
  });

  it("Markdown 降级为纯文本", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      markdown: "## 标题\n**加粗** [链接](url) `代码`\n- 列表",
    });
    const text = extractPlainText(msg);
    expect(text).toContain("标题");
    expect(text).toContain("加粗");
    expect(text).toContain("链接");
    expect(text).not.toContain("**");
    expect(text).not.toContain("##");
  });

  it("图片 Markdown 替换为 [图片]", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      markdown: "看这张 ![alt](https://img.com/pic.png)",
    });
    expect(extractPlainText(msg)).toContain("[图片]");
  });

  it("媒体附件添加占位符", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      text: "文件如下",
      media: [
        { url: "f1.pdf", kind: "document", mimeType: "application/pdf", fileName: "f1.pdf" },
        { url: "img.png", kind: "image", mimeType: "image/png", fileName: "img.png" },
        { url: "song.mp3", kind: "audio", mimeType: "audio/mpeg", fileName: "song.mp3" },
        { url: "vid.mp4", kind: "video", mimeType: "video/mp4", fileName: "vid.mp4" },
      ],
    });
    const text = extractPlainText(msg);
    expect(text).toContain("[图片:");
    expect(text).toContain("[视频:");
    expect(text).toContain("[语音:");
    expect(text).toContain("[文件:");
  });
});

// ============================================================================
// extractMarkdown
// ============================================================================

describe("extractMarkdown", () => {
  it("有 markdown 时用 markdown", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      text: "纯文本", markdown: "**粗体**",
    });
    const md = extractMarkdown(msg);
    expect(md).toBe("**粗体**");
  });

  it("无 markdown 时用 text", () => {
    const msg = buildTextMessage("test", "a", "u", "纯文本");
    expect(extractMarkdown(msg)).toBe("纯文本");
  });

  it("图片媒体添加 Markdown 图片语法", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      text: "看图片",
      media: [{ url: "https://img.com/pic.png", kind: "image", mimeType: "image/png", fileName: "pic" }],
    });
    const md = extractMarkdown(msg);
    expect(md).toContain("![pic](https://img.com/pic.png)");
  });

  it("base64 图片使用 data URI", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      text: "图片",
      media: [{ url: "", kind: "image", mimeType: "image/png", base64: "abc123" }],
    });
    const md = extractMarkdown(msg);
    expect(md).toContain("data:image/png;base64,abc123");
  });

  it("非图片媒体添加链接", () => {
    const msg = buildMessage({
      channel: "test", accountId: "a", userId: "u",
      text: "文档",
      media: [{ url: "https://docs.com/file.pdf", kind: "document", mimeType: "application/pdf", fileName: "file.pdf" }],
    });
    const md = extractMarkdown(msg);
    expect(md).toContain("📎 [file.pdf]");
    expect(md).toContain("(https://docs.com/file.pdf)");
  });
});

// ============================================================================
// parseMediaFromText
// ============================================================================

describe("parseMediaFromText", () => {
  it("解析 Markdown 图片", () => {
    const refs = parseMediaFromText("看这张 ![alt text](https://img.com/pic.png) 图片");
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe("https://img.com/pic.png");
    // kind 从 fileName (alt text) 推断，alt text 无扩展名时回退为 "other"
    expect(refs[0].kind).toBe("other");
  });

  it("解析多条 Markdown 图片", () => {
    const refs = parseMediaFromText("![a](1.png) 和 ![b](2.jpg)");
    expect(refs).toHaveLength(2);
  });

  it("去重相同 URL", () => {
    const refs = parseMediaFromText("![a](same.png) ![b](same.png)");
    expect(refs).toHaveLength(1);
  });

  it("解析 MEDIA: 指令", () => {
    const refs = parseMediaFromText("处理文件\nMEDIA: /tmp/data.csv\n完成");
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe("/tmp/data.csv");
  });

  it("解析裸 HTTP URL", () => {
    const refs = parseMediaFromText("下载 https://cdn.example.com/report.pdf 查看");
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe("https://cdn.example.com/report.pdf");
  });

  it("混合三种格式", () => {
    const refs = parseMediaFromText(
      "图: ![img](https://a.com/pic.png)\nMEDIA: /tmp/doc.pdf\n链接: https://cdn.com/data.xls"
    );
    expect(refs).toHaveLength(3);
  });

  it("空文本返回空数组", () => {
    expect(parseMediaFromText("")).toEqual([]);
    expect(parseMediaFromText("纯文本无媒体")).toEqual([]);
  });
});

// ============================================================================
// 错误类
// ============================================================================

describe("FileSizeLimitError", () => {
  it("media-io 版本: (message, actualSize, limitSize)", () => {
    const err = new FileSizeLimitError("文件过大", 50_000_000, 20_000_000);
    expect(err.name).toBe("FileSizeLimitError");
    expect(err.message).toBe("文件过大");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("MediaTimeoutError", () => {
  it("media-io 版本: (message, timeoutMs)", () => {
    const err = new MediaTimeoutError("超时了", 30000);
    expect(err.name).toBe("MediaTimeoutError");
    expect(err.message).toBe("超时了");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("MessageParseError", () => {
  it("携带原始输入", () => {
    const err = new MessageParseError("bad json", "格式错误");
    expect(err.name).toBe("MessageParseError");
    expect(err.rawInput).toBe("bad json");
    expect(err.message).toContain("格式错误");
  });

  it("无原因时使用默认消息", () => {
    const err = new MessageParseError("{}");
    expect(err.message).toContain("无效的格式");
  });
});
