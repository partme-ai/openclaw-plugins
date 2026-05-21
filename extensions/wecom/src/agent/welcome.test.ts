/**
 * agent/welcome + agent/xml + agent/stream 单元测试
 */
import { describe, it, expect } from "vitest";
import { shouldSendWelcome } from "./welcome.js";
import { extractEncryptFromXml, extractToUserNameFromXml, buildEncryptedXmlResponse } from "./xml.js";
import {
  createStreamId,
  createStream,
  buildStreamPlaceholder,
  buildStreamResponse,
  isStreamExpired,
  getStreamTimeRemaining,
  cleanupExpiredStreams,
} from "./stream.js";

// ============================================================================
// shouldSendWelcome
// ============================================================================

describe("shouldSendWelcome", () => {
  it("enter_chat 触发欢迎", () => {
    expect(shouldSendWelcome("enter_chat")).toBe(true);
  });

  it("subscribe 触发欢迎", () => {
    expect(shouldSendWelcome("subscribe")).toBe(true);
  });

  it("其他事件不触发", () => {
    expect(shouldSendWelcome("click")).toBe(false);
    expect(shouldSendWelcome("")).toBe(false);
    expect(shouldSendWelcome("text")).toBe(false);
  });
});

// ============================================================================
// extractEncryptFromXml / extractToUserNameFromXml / buildEncryptedXmlResponse
// ============================================================================

describe("extractEncryptFromXml", () => {
  it("提取 CDATA 中的 Encrypt 字段", () => {
    const xml = "<xml><Encrypt><![CDATA[encrypted_content_here]]></Encrypt></xml>";
    expect(extractEncryptFromXml(xml)).toBe("encrypted_content_here");
  });

  it("提取不带 CDATA 的 Encrypt", () => {
    const xml = "<xml><Encrypt>plain_content</Encrypt></xml>";
    expect(extractEncryptFromXml(xml)).toBe("plain_content");
  });

  it("无 Encrypt 字段抛出错误", () => {
    expect(() => extractEncryptFromXml("<xml></xml>")).toThrow("missing Encrypt field");
  });
});

describe("extractToUserNameFromXml", () => {
  it("提取 CDATA 中的 ToUserName", () => {
    const xml = "<xml><ToUserName><![CDATA[corp123]]></ToUserName></xml>";
    expect(extractToUserNameFromXml(xml)).toBe("corp123");
  });

  it("缺失返回空字符串", () => {
    expect(extractToUserNameFromXml("<xml></xml>")).toBe("");
  });
});

describe("buildEncryptedXmlResponse", () => {
  it("构建加密 XML 响应", () => {
    const xml = buildEncryptedXmlResponse({
      encrypt: "enc_data",
      signature: "sig123",
      timestamp: "1234567890",
      nonce: "abc123",
    });
    expect(xml).toContain("<Encrypt><![CDATA[enc_data]]></Encrypt>");
    expect(xml).toContain("<MsgSignature><![CDATA[sig123]]></MsgSignature>");
    expect(xml).toContain("<TimeStamp>1234567890</TimeStamp>");
    expect(xml).toContain("<Nonce><![CDATA[abc123]]></Nonce>");
  });
});

// ============================================================================
// createStreamId / createStream / buildStreamPlaceholder / buildStreamResponse
// ============================================================================

describe("createStreamId", () => {
  it("生成非空 ID", () => {
    const id = createStreamId();
    expect(id.length).toBeGreaterThan(10);
  });

  it("每次不同", () => {
    const ids = new Set(Array.from({ length: 20 }, () => createStreamId()));
    expect(ids.size).toBe(20);
  });
});

describe("createStream", () => {
  it("创建新流状态", () => {
    const state = createStream();
    expect(state.streamId).toBeTruthy();
    expect(state.started).toBe(false);
    expect(state.finished).toBe(false);
    expect(state.content).toBe("");
    expect(typeof state.createdAt).toBe("number");
  });
});

describe("buildStreamPlaceholder", () => {
  it("构建占位符响应", () => {
    const r = buildStreamPlaceholder("stream-1");
    expect(r.msgtype).toBe("stream");
    expect(r.stream.id).toBe("stream-1");
    expect(r.stream.finish).toBe(false);
    expect(r.stream.content).toBe("稍等~");
  });
});

describe("buildStreamResponse", () => {
  it("构建流式响应", () => {
    const state = createStream();
    state.content = "回复内容";
    state.finished = true;
    const r = buildStreamResponse(state);
    expect(r.msgtype).toBe("stream");
    expect(r.stream.id).toBe(state.streamId);
    expect(r.stream.finish).toBe(true);
    expect(r.stream.content).toBe("回复内容");
  });

  it("长内容截断", () => {
    const state = createStream();
    state.content = "x".repeat(600_000);
    state.finished = false;
    const r = buildStreamResponse(state);
    const buf = Buffer.from(r.stream.content, "utf8");
    expect(buf.length).toBeLessThanOrEqual(512_001);
  });
});

describe("isStreamExpired", () => {
  it("新流未过期", () => {
    const state = createStream();
    expect(isStreamExpired(state, 6 * 60 * 1000)).toBe(false);
  });

  it("旧流过期", () => {
    const state: any = { createdAt: Date.now() - 10 * 60 * 1000 };
    expect(isStreamExpired(state, 6 * 60 * 1000)).toBe(true);
  });
});

describe("getStreamTimeRemaining", () => {
  it("新流有剩余时间", () => {
    const state: any = { createdAt: Date.now() };
    const remaining = getStreamTimeRemaining(state, 6 * 60 * 1000);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(6 * 60 * 1000);
  });

  it("过期流返回 0", () => {
    const state: any = { createdAt: Date.now() - 10 * 60 * 1000 };
    expect(getStreamTimeRemaining(state, 6 * 60 * 1000)).toBe(0);
  });
});

describe("cleanupExpiredStreams", () => {
  it("不抛异常", () => {
    expect(() => cleanupExpiredStreams()).not.toThrow();
  });
});
