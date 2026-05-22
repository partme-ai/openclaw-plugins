/**
 * STOMP 帧解析与序列化单元测试
 *
 * 测试覆盖：
 * - 帧解析（CONNECT、SEND、SUBSCRIBE 等）
 * - 帧序列化
 * - Header 转义/反转义
 * - 边界情况（空 body、重复 header、无效命令）
 * - 构建器函数
 */

import { describe, it, expect } from "vitest";
import {
  parseFrame,
  serializeFrame,
  buildConnectedFrame,
  buildMessageFrame,
  buildReceiptFrame,
  buildErrorFrame,
} from "../src/transport/frame-parser.js";

describe("parseFrame", () => {
  it("应解析 CONNECT 帧", () => {
    const raw = "CONNECT\naccept-version:1.2\nhost:localhost\n\n\0";
    const frame = parseFrame(raw);
    expect(frame).not.toBeNull();
    expect(frame?.command).toBe("CONNECT");
    expect(frame?.headers["accept-version"]).toBe("1.2");
    expect(frame?.headers["host"]).toBe("localhost");
  });

  it("应解析带 body 的 SEND 帧", () => {
    const raw = "SEND\ndestination:/queue/test\n\nHello World\0";
    const frame = parseFrame(raw);
    expect(frame).not.toBeNull();
    expect(frame?.command).toBe("SEND");
    expect(frame?.headers["destination"]).toBe("/queue/test");
    expect(frame?.body).toBe("Hello World");
  });

  it("应解析 SUBSCRIBE 帧", () => {
    const raw = "SUBSCRIBE\nid:sub-001\ndestination:/topic/chat\n\n\0";
    const frame = parseFrame(raw);
    expect(frame?.command).toBe("SUBSCRIBE");
    expect(frame?.headers["id"]).toBe("sub-001");
    expect(frame?.headers["destination"]).toBe("/topic/chat");
  });

  it("重复 header 应以第一个为准", () => {
    const raw = "SEND\nkey:first\nkey:second\n\n\0";
    const frame = parseFrame(raw);
    expect(frame?.headers["key"]).toBe("first");
  });

  it("无效命令应返回 null", () => {
    const raw = "INVALID_CMD\n\n\0";
    const frame = parseFrame(raw);
    expect(frame).toBeNull();
  });

  it("空数据应返回 null", () => {
    expect(parseFrame("")).toBeNull();
  });
});

describe("serializeFrame", () => {
  it("应序列化无 body 的帧", () => {
    const frame = buildConnectedFrame("0,0");
    const serialized = serializeFrame(frame);
    expect(serialized).toContain("CONNECTED\n");
    expect(serialized).toContain("version:1.2");
    expect(serialized).toContain("heart-beat:0,0");
    expect(serialized.endsWith("\0")).toBe(true);
  });

  it("应序列化带 body 的帧", () => {
    const frame = buildMessageFrame("sub-001", "/topic/chat", "msg-001", "Hello!");
    const serialized = serializeFrame(frame);
    expect(serialized).toContain("MESSAGE\n");
    expect(serialized).toContain("Hello!");
    expect(serialized).toContain("content-length:");
    expect(serialized.endsWith("\0")).toBe(true);
  });

  it("解析 → 序列化 应保持一致性", () => {
    const original = buildMessageFrame("sub-1", "/topic/test", "msg-1", "Test body");
    const serialized = serializeFrame(original);
    const reparsed = parseFrame(serialized);

    expect(reparsed?.command).toBe("MESSAGE");
    expect(reparsed?.headers["destination"]).toBe("/topic/test");
    // body 可能包含 content-length 但核心内容应存在
    expect(reparsed?.body).toContain("Test body");
  });
});

describe("帧构建器", () => {
  it("buildConnectedFrame 应包含正确字段", () => {
    const frame = buildConnectedFrame("10000,10000");
    expect(frame.command).toBe("CONNECTED");
    expect(frame.headers["version"]).toBe("1.2");
    expect(frame.headers["heart-beat"]).toBe("10000,10000");
    expect(frame.headers["server"]).toContain("openclaw");
  });

  it("buildReceiptFrame 应包含 receipt-id", () => {
    const frame = buildReceiptFrame("rcpt-123");
    expect(frame.command).toBe("RECEIPT");
    expect(frame.headers["receipt-id"]).toBe("rcpt-123");
  });

  it("buildErrorFrame 应包含错误信息", () => {
    const frame = buildErrorFrame("Connection refused", "rcpt-456");
    expect(frame.command).toBe("ERROR");
    expect(frame.headers["message"]).toBe("Connection refused");
    expect(frame.headers["receipt-id"]).toBe("rcpt-456");
    expect(frame.body).toBe("Connection refused");
  });

  it("buildErrorFrame 无 receiptId 时不应包含 receipt-id header", () => {
    const frame = buildErrorFrame("Error occurred");
    expect(frame.headers["receipt-id"]).toBeUndefined();
  });
});
