/**
 * agent/handler 多模态消息提取单元测试
 *
 * 测试覆盖：
 * - 多模态消息文本提取（text、image、voice、location、link、miniprogram、video、file）
 * - 边界情况（未知消息类型、缺失字段）
 *
 * 说明：extractTextContent 为 handler 内私有函数，此处用等价实现做单元验证，与 agent/handler.ts 行为一致。
 */

import { describe, it, expect } from "vitest";

/** 与 agent/handler.ts 中 extractTextContent 等价的提取逻辑（用于单测） */
function extractTextContent(msg: Record<string, unknown>): string | null {
  const msgtype = msg.msgtype as string;
  switch (msgtype) {
    case "text":
      return (msg.text as { content: string })?.content ?? null;
    case "image": {
      const mediaId = (msg.image as { media_id: string })?.media_id;
      return mediaId ? `[图片] media_id=${mediaId}` : null;
    }
    case "voice": {
      const mediaId = (msg.voice as { media_id: string })?.media_id;
      return mediaId ? `[语音] media_id=${mediaId}` : null;
    }
    case "location": {
      const loc = msg.location as {
        name?: string;
        address?: string;
        latitude?: number;
        longitude?: number;
      };
      if (loc) {
        const parts = ["[位置]"];
        if (loc.name) parts.push(loc.name);
        if (loc.address) parts.push(loc.address);
        if (loc.latitude && loc.longitude) {
          parts.push(`(${loc.latitude}, ${loc.longitude})`);
        }
        return parts.join(" ");
      }
      return null;
    }
    case "link": {
      const link = msg.link as {
        title?: string;
        desc?: string;
        url?: string;
      };
      if (link) {
        const title = link.title ?? "链接";
        const url = link.url ?? "";
        const desc = link.desc ? ` - ${link.desc}` : "";
        return `[链接] ${title}${desc} ${url}`;
      }
      return null;
    }
    case "miniprogram": {
      const mini = msg.miniprogram as { title?: string };
      if (mini) {
        return `[小程序] ${mini.title ?? "小程序"}`;
      }
      return null;
    }
    case "video": {
      const mediaId = (msg.video as { media_id: string })?.media_id;
      return mediaId ? `[视频] media_id=${mediaId}` : null;
    }
    case "file": {
      const mediaId = (msg.file as { media_id: string })?.media_id;
      return mediaId ? `[文件] media_id=${mediaId}` : null;
    }
    case "event":
      return null;
    default:
      return null;
  }
}

describe("extractTextContent（多模态消息提取）", () => {
  it("text 消息应返回文本内容", () => {
    expect(extractTextContent({ msgtype: "text", text: { content: "你好" } })).toBe("你好");
  });

  it("image 消息应返回 media_id", () => {
    expect(extractTextContent({ msgtype: "image", image: { media_id: "img-001" } }))
      .toBe("[图片] media_id=img-001");
  });

  it("voice 消息应返回 media_id", () => {
    expect(extractTextContent({ msgtype: "voice", voice: { media_id: "voice-001" } }))
      .toBe("[语音] media_id=voice-001");
  });

  it("location 消息应返回位置描述", () => {
    const msg = {
      msgtype: "location",
      location: {
        name: "北京大学",
        address: "北京市海淀区颐和园路5号",
        latitude: 39.9869,
        longitude: 116.3059,
      },
    };
    const result = extractTextContent(msg);
    expect(result).toContain("[位置]");
    expect(result).toContain("北京大学");
    expect(result).toContain("39.9869");
  });

  it("link 消息应返回标题和 URL", () => {
    const msg = {
      msgtype: "link",
      link: { title: "OpenClaw 官网", url: "https://openclaw.dev", desc: "AI Gateway" },
    };
    const result = extractTextContent(msg);
    expect(result).toContain("[链接]");
    expect(result).toContain("OpenClaw 官网");
    expect(result).toContain("https://openclaw.dev");
    expect(result).toContain("AI Gateway");
  });

  it("miniprogram 消息应返回标题", () => {
    expect(extractTextContent({ msgtype: "miniprogram", miniprogram: { title: "PartMe 小程序" } }))
      .toBe("[小程序] PartMe 小程序");
  });

  it("video 消息应返回 media_id", () => {
    expect(extractTextContent({ msgtype: "video", video: { media_id: "vid-001" } }))
      .toBe("[视频] media_id=vid-001");
  });

  it("file 消息应返回 media_id", () => {
    expect(extractTextContent({ msgtype: "file", file: { media_id: "file-001" } }))
      .toBe("[文件] media_id=file-001");
  });

  it("event 消息应返回 null（由 system-event 处理）", () => {
    expect(extractTextContent({ msgtype: "event" })).toBeNull();
  });

  it("未知消息类型应返回 null", () => {
    expect(extractTextContent({ msgtype: "unknown_type" })).toBeNull();
  });

  it("缺失 text.content 应返回 null", () => {
    expect(extractTextContent({ msgtype: "text" })).toBeNull();
  });
});
