/**
 * message-parser 单元测试 — parseMessageContent 覆盖所有消息类型
 */
import { describe, it, expect } from "vitest";
import { parseMessageContent, type MessageBody } from "./message-parser.js";

// ============================================================================
// Helper
// ============================================================================

function body(overrides: Partial<MessageBody> = {}): MessageBody {
  return {
    msgid: "msg-001",
    chattype: "single",
    from: { userid: "user123" },
    msgtype: "text",
    ...overrides,
  };
}

// ============================================================================
// text 消息
// ============================================================================

describe("parseMessageContent — text", () => {
  it("提取纯文本内容", () => {
    const result = parseMessageContent(body({ text: { content: "你好世界" } }));
    expect(result.textParts).toEqual(["你好世界"]);
    expect(result.imageUrls).toEqual([]);
    expect(result.fileUrls).toEqual([]);
  });

  it("空文本内容不加入（空字符串为 falsy）", () => {
    const result = parseMessageContent(body({ text: { content: "" } }));
    expect(result.textParts).toEqual([]);
  });

  it("无 text 字段", () => {
    const result = parseMessageContent(body());
    expect(result.textParts).toEqual([]);
  });
});

// ============================================================================
// image 消息
// ============================================================================

describe("parseMessageContent — image", () => {
  it("提取图片 URL 和 AES Key", () => {
    const result = parseMessageContent(body({
      msgtype: "image",
      image: { url: "https://example.com/img.jpg", aeskey: "key123" },
    }));
    expect(result.imageUrls).toEqual(["https://example.com/img.jpg"]);
    expect(result.imageAesKeys.get("https://example.com/img.jpg")).toBe("key123");
    expect(result.textParts).toEqual([]);
  });

  it("无 AES Key 的图片", () => {
    const result = parseMessageContent(body({
      msgtype: "image",
      image: { url: "https://example.com/img.jpg" },
    }));
    expect(result.imageUrls).toEqual(["https://example.com/img.jpg"]);
    expect(result.imageAesKeys.has("https://example.com/img.jpg")).toBe(false);
  });
});

// ============================================================================
// voice 消息
// ============================================================================

describe("parseMessageContent — voice", () => {
  it("提取语音转文字内容", () => {
    const result = parseMessageContent(body({
      msgtype: "voice",
      voice: { content: "今天天气怎么样" },
    }));
    expect(result.textParts).toEqual(["今天天气怎么样"]);
  });

  it("无语音内容", () => {
    const result = parseMessageContent(body({
      msgtype: "voice",
      voice: {},
    }));
    expect(result.textParts).toEqual([]);
  });
});

// ============================================================================
// file 消息
// ============================================================================

describe("parseMessageContent — file", () => {
  it("提取文件 URL", () => {
    const result = parseMessageContent(body({
      msgtype: "file",
      file: { url: "https://example.com/doc.pdf", aeskey: "fkey" },
    }));
    expect(result.fileUrls).toEqual(["https://example.com/doc.pdf"]);
    expect(result.fileAesKeys.get("https://example.com/doc.pdf")).toBe("fkey");
  });
});

// ============================================================================
// video 消息
// ============================================================================

describe("parseMessageContent — video", () => {
  it("视频作为文件附件处理", () => {
    const result = parseMessageContent(body({
      msgtype: "video",
      video: { url: "https://example.com/vid.mp4", aeskey: "vkey" },
    }));
    expect(result.fileUrls).toEqual(["https://example.com/vid.mp4"]);
  });
});

// ============================================================================
// mixed 图文混排消息
// ============================================================================

describe("parseMessageContent — mixed", () => {
  it("提取文本和图片", () => {
    const result = parseMessageContent(body({
      msgtype: "mixed",
      mixed: {
        msg_item: [
          { msgtype: "text", text: { content: "看图" } },
          { msgtype: "image", image: { url: "https://img.com/pic.png", aeskey: "k1" } },
          { msgtype: "text", text: { content: "这张" } },
        ],
      },
    }));
    expect(result.textParts).toEqual(["看图", "这张"]);
    expect(result.imageUrls).toEqual(["https://img.com/pic.png"]);
    expect(result.imageAesKeys.get("https://img.com/pic.png")).toBe("k1");
  });

  it("空 mixed msg_item", () => {
    const result = parseMessageContent(body({
      msgtype: "mixed",
      mixed: { msg_item: [] },
    }));
    expect(result.textParts).toEqual([]);
  });
});

// ============================================================================
// event — template_card_event
// ============================================================================

describe("parseMessageContent — template_card_event", () => {
  it("格式化模板卡片选择事件", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      chatid: "chat-99",
      from: { userid: "user1", corpid: "corp1" },
      event: {
        eventtype: "template_card_event",
        template_card_event: {
          card_type: "button_interaction",
          event_key: "approve",
          task_id: "task-42",
          selected_items: {
            selected_item: [
              { question_key: "reason", option_ids: { option_id: ["opt_a", "opt_b"] } },
            ],
          },
        },
      },
    }));
    expect(result.textParts).toHaveLength(1);
    const text = result.textParts[0];
    expect(text).toContain("template_card_event");
    expect(text).toContain("button_interaction");
    expect(text).toContain("approve");
    expect(text).toContain("task-42");
    expect(text).toContain("reason");
    expect(text).toContain("opt_a, opt_b");
    expect(text).toContain("user1");
  });

  it("模板卡片无选择项", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      event: {
        eventtype: "template_card_event",
        template_card_event: {
          card_type: "text_notice",
          event_key: "click",
        },
      },
    }));
    expect(result.textParts).toHaveLength(1);
    expect(result.textParts[0]).toContain("selected_items(选择项): []");
  });
});

// ============================================================================
// event — auth_change_event
// ============================================================================

describe("parseMessageContent — auth_change_event", () => {
  it("文档授权事件-含文档内容权限", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      from: { userid: "admin1", chat_id: "chat-doc" },
      event: {
        eventtype: "auth_change_event",
        auth_change_event: { auth_list: [1, 2] },
      },
    }));
    expect(result.textParts).toHaveLength(1);
    expect(result.textParts[0]).toContain("auth_change_event");
    expect(result.textParts[0]).toContain("新建和编辑文档");
    expect(result.textParts[0]).toContain("获取成员文档内容");
    expect(result.textParts[0]).toContain("请继续之前的文档操作");
  });

  it("文档授权事件-无文档内容权限", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      from: { userid: "user2" },
      event: {
        eventtype: "auth_change_event",
        auth_change_event: { auth_list: [1] },
      },
    }));
    expect(result.textParts[0]).toContain("请引导用户授予");
  });

  it("文档授权事件-空权限列表", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      event: {
        eventtype: "auth_change_event",
        auth_change_event: { auth_list: [] },
      },
    }));
    expect(result.textParts[0]).toContain("请引导用户完成文档授权");
  });
});

// ============================================================================
// quote 引用消息
// ============================================================================

describe("parseMessageContent — quote", () => {
  it("引用文本消息", () => {
    const result = parseMessageContent(body({
      text: { content: "回复内容" },
      quote: { msgtype: "text", text: { content: "原始问题" } },
    }));
    expect(result.textParts).toEqual(["回复内容"]);
    expect(result.quoteContent).toBe("原始问题");
  });

  it("引用语音消息", () => {
    const result = parseMessageContent(body({
      text: { content: "好" },
      quote: { msgtype: "voice", voice: { content: "转文字结果" } },
    }));
    expect(result.quoteContent).toBe("转文字结果");
  });

  it("引用图片消息（加入下载列表）", () => {
    const result = parseMessageContent(body({
      text: { content: "看看" },
      quote: { msgtype: "image", image: { url: "https://img.com/q.jpg", aeskey: "qk" } },
    }));
    expect(result.imageUrls).toContain("https://img.com/q.jpg");
    expect(result.imageAesKeys.get("https://img.com/q.jpg")).toBe("qk");
  });

  it("引用文件消息（加入下载列表）", () => {
    const result = parseMessageContent(body({
      text: { content: "文件" },
      quote: { msgtype: "file", file: { url: "https://files.com/d.pdf", aeskey: "dk" } },
    }));
    expect(result.fileUrls).toContain("https://files.com/d.pdf");
  });

  it("引用视频消息（加入文件列表）", () => {
    const result = parseMessageContent(body({
      text: { content: "视频" },
      quote: { msgtype: "video", video: { url: "https://vid.com/v.mp4", aeskey: "vk" } },
    }));
    expect(result.fileUrls).toContain("https://vid.com/v.mp4");
  });
});

// ============================================================================
// 边界条件
// ============================================================================

describe("parseMessageContent — 边界条件", () => {
  it("未知消息类型返回空", () => {
    const result = parseMessageContent(body({ msgtype: "unknown_type" }));
    expect(result.textParts).toEqual([]);
    expect(result.imageUrls).toEqual([]);
    expect(result.fileUrls).toEqual([]);
  });

  it("空 body 返回全空", () => {
    const result = parseMessageContent({} as MessageBody);
    expect(result.textParts).toEqual([]);
    expect(result.imageUrls).toEqual([]);
    expect(result.fileUrls).toEqual([]);
    expect(result.quoteContent).toBeUndefined();
  });

  it("event 非 template_card_event 也非 auth_change_event", () => {
    const result = parseMessageContent(body({
      msgtype: "event",
      event: { eventtype: "click" },
    }));
    // template_card_event 未命中 → buildTemplateCardEventText 返回 undefined
    // auth_change_event 未命中 → buildAuthChangeEventText 返回 undefined
    // textParts 仍为空
    expect(result.textParts).toEqual([]);
  });

  it("mixed 消息含未知 item type", () => {
    const result = parseMessageContent(body({
      msgtype: "mixed",
      mixed: {
        msg_item: [
          { msgtype: "unknown", text: { content: "x" } } as any,
        ],
      },
    }));
    // 未知类型不提取
    expect(result.textParts).toEqual([]);
  });
});
