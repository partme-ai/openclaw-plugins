/**
 * webhook/helpers 单元测试 — 所有纯逻辑辅助函数
 */
import { describe, it, expect } from "vitest";
import {
  buildInboundBody,
  formatQuote,
  truncateUtf8Bytes,
  buildFallbackPrompt,
  computeMd5,
  guessContentTypeFromPath,
  resolveWecomSenderUserId,
  hasMedia,
  looksLikeSendLocalFileIntent,
  extractLocalFilePathsFromText,
  extractLocalImagePathsFromText,
  buildStreamReplyFromState,
  buildStreamPlaceholderReply,
  buildStreamTextPlaceholderReply,
  buildStreamResponse,
  buildCfgForDispatch,
  computeTaskKey,
  isAgentConfigured,
  appendDmContent,
  resolveWecomMediaMaxBytes,
  MIME_BY_EXT,
} from "./helpers.js";
import type { StreamState, WecomWebhookTarget, WebhookInboundMessage, WebhookInboundQuote } from "./types.js";

// ============================================================================
// buildInboundBody
// ============================================================================

describe("buildInboundBody", () => {
  function msg(overrides: Partial<WebhookInboundMessage> = {}): WebhookInboundMessage {
    return { msgtype: "text", ...overrides };
  }

  it("text 消息", () => {
    expect(buildInboundBody(msg({ text: { content: "你好" } }))).toBe("你好");
  });

  it("voice 消息", () => {
    expect(buildInboundBody(msg({ msgtype: "voice", voice: { content: "转文字" } }))).toBe("转文字");
    expect(buildInboundBody(msg({ msgtype: "voice" }))).toBe("[voice]");
  });

  it("image 消息", () => {
    expect(buildInboundBody(msg({ msgtype: "image", image: { url: "https://i.com/p.jpg" } })))
      .toBe("[image] https://i.com/p.jpg");
  });

  it("file 消息", () => {
    expect(buildInboundBody(msg({ msgtype: "file", file: { url: "https://f.com/d.pdf" } })))
      .toBe("[file] https://f.com/d.pdf");
  });

  it("video 消息", () => {
    expect(buildInboundBody(msg({ msgtype: "video", video: { url: "https://v.com/v.mp4" } })))
      .toBe("[video] https://v.com/v.mp4");
  });

  it("mixed 消息", () => {
    const body = buildInboundBody(msg({
      msgtype: "mixed",
      mixed: {
        msg_item: [
          { msgtype: "text", text: { content: "图1" } },
          { msgtype: "image", image: { url: "https://i.com/a.png" } },
        ] as any,
      },
    }));
    expect(body).toContain("图1");
    expect(body).toContain("[image] https://i.com/a.png");
  });

  it("event 消息", () => {
    expect(buildInboundBody(msg({
      msgtype: "event",
      event: { eventtype: "template_card_event" },
    }))).toBe("[event] template_card_event");
  });

  it("stream 消息", () => {
    expect(buildInboundBody(msg({
      msgtype: "stream",
      stream: { id: "stream-1" },
    }))).toBe("[stream_refresh] stream-1");
  });

  it("未知类型", () => {
    expect(buildInboundBody(msg({ msgtype: "unknown" }))).toBe("[unknown]");
  });

  it("含 quote 引用", () => {
    const body = buildInboundBody(msg({
      text: { content: "回复" },
      quote: { msgtype: "text", text: { content: "原文" } },
    }));
    expect(body).toContain("回复");
    expect(body).toContain("原文");
  });
});

// ============================================================================
// formatQuote
// ============================================================================

describe("formatQuote", () => {
  it("text 引用", () => {
    expect(formatQuote({ msgtype: "text", text: { content: "原文内容" } })).toBe("原文内容");
  });

  it("image 引用", () => {
    const r = formatQuote({ msgtype: "image", image: { url: "https://i.com/q.jpg" } });
    expect(r).toContain("[引用: 图片]");
    expect(r).toContain("https://i.com/q.jpg");
  });

  it("voice 引用", () => {
    expect(formatQuote({ msgtype: "voice", voice: { content: "语音内容" } }))
      .toBe("[引用: 语音] 语音内容");
  });

  it("file 引用", () => {
    expect(formatQuote({ msgtype: "file", file: { url: "https://f.com/d.pdf" } }))
      .toBe("[引用: 文件] https://f.com/d.pdf");
  });

  it("video 引用", () => {
    expect(formatQuote({ msgtype: "video", video: { url: "https://v.com/v.mp4" } }))
      .toBe("[引用: 视频] https://v.com/v.mp4");
  });

  it("mixed 引用", () => {
    const r = formatQuote({
      msgtype: "mixed",
      mixed: {
        msg_item: [
          { msgtype: "text", text: { content: "文" } },
          { msgtype: "image", image: { url: "https://i.com/m.png" } },
        ] as any,
      },
    });
    expect(r).toContain("[引用: 图文]");
    expect(r).toContain("文");
    expect(r).toContain("[图片]");
  });

  it("空引用返回空字符串", () => {
    expect(formatQuote({} as WebhookInboundQuote)).toBe("");
  });
});

// ============================================================================
// truncateUtf8Bytes
// ============================================================================

describe("truncateUtf8Bytes", () => {
  it("短文本不变", () => {
    expect(truncateUtf8Bytes("hello", 100)).toBe("hello");
  });

  it("截断长文本保留尾部", () => {
    const long = "a".repeat(5000);
    const result = truncateUtf8Bytes(long, 100);
    expect(Buffer.from(result, "utf8").length).toBeLessThanOrEqual(101); // UTF-8 boundary
    expect(result.length).toBeLessThan(long.length);
  });

  it("中文截断", () => {
    const chinese = "你好世界".repeat(100);
    const result = truncateUtf8Bytes(chinese, 50);
    // 截断后应比原始短且非空
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(chinese.length);
  });
});

// ============================================================================
// buildFallbackPrompt
// ============================================================================

describe("buildFallbackPrompt", () => {
  it("媒体兜底+Agent已配置", () => {
    const p = buildFallbackPrompt({ kind: "media", agentConfigured: true, userId: "user1", filename: "doc.pdf" });
    expect(p).toContain("doc.pdf");
    expect(p).toContain("应用私信发送");
    expect(p).toContain("user1");
  });

  it("超时兜底+群聊", () => {
    const p = buildFallbackPrompt({ kind: "timeout", agentConfigured: true, userId: "user2", chatType: "group" });
    // timeout 类型不输出 scope（群聊/私聊），只输出兜底原因
    expect(p).toContain("应用私信发送");
    expect(p).toContain("user2");
  });

  it("Agent未配置", () => {
    const p = buildFallbackPrompt({ kind: "media", agentConfigured: false, userId: "u1" });
    expect(p).toContain("尚未配置");
    expect(p).toContain("自建应用（Agent）");
  });

  it("无 userId 时提示排查", () => {
    const p = buildFallbackPrompt({ kind: "error", agentConfigured: true });
    expect(p).toContain("未能识别触发者");
  });

  it("普通错误兜底", () => {
    const p = buildFallbackPrompt({ kind: "error", agentConfigured: true, userId: "u1" });
    expect(p).toContain("交付出现异常");
  });
});

// ============================================================================
// computeMd5
// ============================================================================

describe("computeMd5", () => {
  it("计算字符串 MD5", () => {
    expect(computeMd5("hello")).toHaveLength(32);
    expect(computeMd5("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("计算 Buffer MD5", () => {
    const buf = Buffer.from("test data");
    expect(computeMd5(buf)).toHaveLength(32);
  });

  it("确定性", () => {
    expect(computeMd5("abc")).toBe(computeMd5("abc"));
  });

  it("不同输入不同哈希", () => {
    expect(computeMd5("abc")).not.toBe(computeMd5("abd"));
  });
});

// ============================================================================
// guessContentTypeFromPath
// ============================================================================

describe("guessContentTypeFromPath", () => {
  it("常见扩展名", () => {
    expect(guessContentTypeFromPath("photo.png")).toBe("image/png");
    expect(guessContentTypeFromPath("doc.pdf")).toBe("application/pdf");
    expect(guessContentTypeFromPath("song.mp3")).toBe("audio/mpeg");
    expect(guessContentTypeFromPath("video.mp4")).toBe("video/mp4");
    expect(guessContentTypeFromPath("sheet.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("未知扩展名返回 undefined", () => {
    expect(guessContentTypeFromPath("file.xyz")).toBeUndefined();
  });

  it("无扩展名返回 undefined", () => {
    expect(guessContentTypeFromPath("noext")).toBeUndefined();
  });
});

// ============================================================================
// resolveWecomSenderUserId
// ============================================================================

describe("resolveWecomSenderUserId", () => {
  it("from.userid 优先", () => {
    expect(resolveWecomSenderUserId({ msgtype: "text", from: { userid: "user1" } })).toBe("user1");
  });

  it("回退到 fromuserid", () => {
    expect(resolveWecomSenderUserId({ msgtype: "text", fromuserid: "user2" } as any)).toBe("user2");
  });

  it("回退到 from_userid", () => {
    expect(resolveWecomSenderUserId({ msgtype: "text", from_userid: "user3" } as any)).toBe("user3");
  });

  it("缺失返回 undefined", () => {
    expect(resolveWecomSenderUserId({ msgtype: "text" })).toBeUndefined();
  });
});

// ============================================================================
// hasMedia
// ============================================================================

describe("hasMedia", () => {
  it("image 消息有媒体", () => {
    expect(hasMedia({ msgtype: "image" })).toBe(true);
  });

  it("file 消息有媒体", () => {
    expect(hasMedia({ msgtype: "file" })).toBe(true);
  });

  it("voice 消息有媒体", () => {
    expect(hasMedia({ msgtype: "voice" })).toBe(true);
  });

  it("video 消息有媒体", () => {
    expect(hasMedia({ msgtype: "video" })).toBe(true);
  });

  it("text 消息无媒体", () => {
    expect(hasMedia({ msgtype: "text" })).toBe(false);
  });

  it("mixed 含图片时有媒体", () => {
    expect(hasMedia({
      msgtype: "mixed",
      mixed: { msg_item: [{ msgtype: "image" }] as any },
    })).toBe(true);
  });

  it("mixed 纯文本时无媒体", () => {
    expect(hasMedia({
      msgtype: "mixed",
      mixed: { msg_item: [{ msgtype: "text" }] as any },
    })).toBe(false);
  });
});

// ============================================================================
// looksLikeSendLocalFileIntent
// ============================================================================

describe("looksLikeSendLocalFileIntent", () => {
  it("发送意图", () => {
    expect(looksLikeSendLocalFileIntent("发送文件给用户")).toBe(true);
    expect(looksLikeSendLocalFileIntent("发给张三")).toBe(true);
    expect(looksLikeSendLocalFileIntent("帮我发一下")).toBe(true);
    expect(looksLikeSendLocalFileIntent("把报告发送出去")).toBe(true);
    expect(looksLikeSendLocalFileIntent("给我发")).toBe(true);
  });

  it("非发送意图", () => {
    expect(looksLikeSendLocalFileIntent("查看文件内容")).toBe(false);
    expect(looksLikeSendLocalFileIntent("分析这个文档")).toBe(false);
  });

  it("空文本", () => {
    expect(looksLikeSendLocalFileIntent("")).toBe(false);
    expect(looksLikeSendLocalFileIntent("   ")).toBe(false);
  });
});

// ============================================================================
// extractLocalFilePathsFromText
// ============================================================================

describe("extractLocalFilePathsFromText", () => {
  it("提取 /tmp 路径", () => {
    const paths = extractLocalFilePathsFromText("文件在 /tmp/data.csv 请查看");
    expect(paths).toContain("/tmp/data.csv");
  });

  it("提取 /Users 路径", () => {
    const paths = extractLocalFilePathsFromText("路径: /Users/test/report.pdf");
    expect(paths).toContain("/Users/test/report.pdf");
  });

  it("无路径返回空数组", () => {
    expect(extractLocalFilePathsFromText("没有本地路径")).toEqual([]);
  });

  it("空文本返回空", () => {
    expect(extractLocalFilePathsFromText("")).toEqual([]);
  });
});

// ============================================================================
// extractLocalImagePathsFromText
// ============================================================================

describe("extractLocalImagePathsFromText", () => {
  it("提取图片路径且必须在 mustAlsoAppearIn 中", () => {
    const text = "图片 /tmp/photo.png 在这里";
    const paths = extractLocalImagePathsFromText({
      text,
      mustAlsoAppearIn: "/tmp/photo.png",
    });
    expect(paths).toContain("/tmp/photo.png");
  });

  it("不在 mustAlsoAppearIn 中的路径被过滤", () => {
    const paths = extractLocalImagePathsFromText({
      text: "图片 /tmp/photo.png",
      mustAlsoAppearIn: "/other/path.jpg",
    });
    expect(paths).toEqual([]);
  });
});

// ============================================================================
// buildStreamReplyFromState / buildStreamPlaceholderReply / buildStreamResponse
// ============================================================================

describe("Stream Reply 构建", () => {
  it("buildStreamReplyFromState — 基本结构", () => {
    const state: StreamState = {
      streamId: "s1", content: "回复内容", finished: true,
      createdAt: Date.now(), updatedAt: Date.now(), started: true,
    };
    const reply = buildStreamReplyFromState(state, 99999);
    expect(reply.msgtype).toBe("stream");
    const stream = reply.stream as Record<string, unknown>;
    expect(stream.id).toBe("s1");
    expect(stream.finish).toBe(true);
    expect(stream.content).toBe("回复内容");
  });

  it("buildStreamReplyFromState — 含图片", () => {
    const state: StreamState = {
      streamId: "s2", content: "看图", finished: true,
      createdAt: Date.now(), updatedAt: Date.now(), started: true,
      images: [{ base64: "abc", md5: "def" }],
    };
    const reply = buildStreamReplyFromState(state, 99999);
    const stream = reply.stream as Record<string, unknown>;
    expect(stream.msg_item).toBeDefined();
    const items = stream.msg_item as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].msgtype).toBe("image");
  });

  it("buildStreamPlaceholderReply", () => {
    const reply = buildStreamPlaceholderReply("s1", "思考中...");
    const stream = reply.stream as Record<string, unknown>;
    expect(stream.id).toBe("s1");
    expect(stream.finish).toBe(false);
    expect(stream.content).toBe("思考中...");
  });

  it("buildStreamPlaceholderReply — 默认值", () => {
    const reply = buildStreamPlaceholderReply("s1");
    expect((reply.stream as any).content).toBe("1");
  });

  it("buildStreamTextPlaceholderReply", () => {
    const reply = buildStreamTextPlaceholderReply("s2", "处理中...");
    const stream = reply.stream as Record<string, unknown>;
    expect(stream.id).toBe("s2");
    expect(stream.content).toBe("处理中...");
  });

  it("buildStreamResponse", () => {
    const state: StreamState = {
      streamId: "s3", content: "流式内容", finished: false,
      createdAt: Date.now(), updatedAt: Date.now(), started: true,
    };
    const reply = buildStreamResponse(state);
    expect(reply.msgtype).toBe("stream");
    expect((reply.stream as any).content).toBe("流式内容");
    expect((reply.stream as any).finish).toBe(false);
  });
});

// ============================================================================
// buildCfgForDispatch
// ============================================================================

describe("buildCfgForDispatch", () => {
  it("注入 message deny + blockStreaming 默认值", () => {
    const cfg = buildCfgForDispatch({} as any);
    // tools.deny 包含 "message"
    const tools = cfg as any;
    expect(tools.tools.deny).toContain("message");
    // sandbox tools deny 也包含 "message"
    expect(tools.tools.sandbox.tools.deny).toContain("message");
  });

  it("保留已有 deny 列表并追加", () => {
    const cfg = buildCfgForDispatch({
      tools: { deny: ["dangerous_tool"] },
    } as any);
    const deny = (cfg as any).tools.deny;
    expect(deny).toContain("dangerous_tool");
    expect(deny).toContain("message");
  });

  it("设置 blockStreaming 默认值", () => {
    const cfg = buildCfgForDispatch({} as any);
    const defaults = (cfg as any).agents.defaults;
    expect(defaults.blockStreamingChunk.minChars).toBe(120);
    expect(defaults.blockStreamingCoalesce.idleMs).toBe(250);
  });
});

// ============================================================================
// computeTaskKey / isAgentConfigured
// ============================================================================

describe("computeTaskKey / isAgentConfigured", () => {
  it("computeTaskKey 生成 taskKey", () => {
    const target = { account: { accountId: "acct1" } } as WecomWebhookTarget;
    const msg: WebhookInboundMessage = {
      msgtype: "text",
      msgid: "msg-001",
      aibotid: "bot-123",
    };
    const key = computeTaskKey(target, msg);
    expect(key).toBe("bot:acct1:bot-123:msg-001");
  });

  it("computeTaskKey 无 msgid 返回 undefined", () => {
    const target = { account: { accountId: "acct1" } } as WecomWebhookTarget;
    expect(computeTaskKey(target, { msgtype: "text" })).toBeUndefined();
  });

  it("isAgentConfigured", () => {
    expect(isAgentConfigured({
      account: { agent: { configured: true } },
    } as any)).toBe(true);
    expect(isAgentConfigured({
      account: { agent: { configured: false } },
    } as any)).toBe(false);
    expect(isAgentConfigured({
      account: {},
    } as any)).toBe(false);
  });
});

// ============================================================================
// appendDmContent
// ============================================================================

describe("appendDmContent", () => {
  it("追加文本到 StreamState", () => {
    const state: StreamState = {
      streamId: "s1", content: "", finished: false,
      createdAt: Date.now(), updatedAt: Date.now(), started: true,
    };
    appendDmContent(state, "第一段");
    expect(state.dmContent).toBe("第一段");
    appendDmContent(state, "第二段");
    expect(state.dmContent).toContain("第一段");
    expect(state.dmContent).toContain("第二段");
  });
});

// ============================================================================
// resolveWecomMediaMaxBytes
// ============================================================================

describe("resolveWecomMediaMaxBytes", () => {
  it("读取配置值", () => {
    const cfg = { channels: { wecom: { media: { maxBytes: 50 * 1024 * 1024 } } } } as any;
    expect(resolveWecomMediaMaxBytes(cfg)).toBe(50 * 1024 * 1024);
  });

  it("无通道配置时使用 agents.defaults.mediaMaxMb", () => {
    const cfg = { agents: { defaults: { mediaMaxMb: 10 } } } as any;
    expect(resolveWecomMediaMaxBytes(cfg)).toBe(10 * 1024 * 1024);
  });

  it("无配置时返回默认 20MB", () => {
    expect(resolveWecomMediaMaxBytes({} as any)).toBe(20 * 1024 * 1024);
  });

  it("通道 maxBytes 优先于全局 mediaMaxMb", () => {
    const cfg = {
      channels: { wecom: { media: { maxBytes: 30 * 1024 * 1024 } } },
      agents: { defaults: { mediaMaxMb: 10 } },
    } as any;
    expect(resolveWecomMediaMaxBytes(cfg)).toBe(30 * 1024 * 1024);
  });

  it("配置值为 0 时回退到 agents.defaults.mediaMaxMb", () => {
    const cfg = {
      channels: { wecom: { media: { maxBytes: 0 } } },
      agents: { defaults: { mediaMaxMb: 8 } },
    } as any;
    expect(resolveWecomMediaMaxBytes(cfg)).toBe(8 * 1024 * 1024);
  });

  it("配置值为 0 且无全局配置时使用默认 20MB", () => {
    const cfg = { channels: { wecom: { media: { maxBytes: 0 } } } } as any;
    expect(resolveWecomMediaMaxBytes(cfg)).toBe(20 * 1024 * 1024);
  });
});

// ============================================================================
// MIME_BY_EXT 常量
// ============================================================================

describe("MIME_BY_EXT", () => {
  it("包含常见类型", () => {
    expect(MIME_BY_EXT.png).toBe("image/png");
    expect(MIME_BY_EXT.pdf).toBe("application/pdf");
    expect(MIME_BY_EXT.docx).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(MIME_BY_EXT.amr).toBe("voice/amr");
  });
});
