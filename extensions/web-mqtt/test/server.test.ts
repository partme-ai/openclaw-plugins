/**
 * ws-server 统计函数测试。
 * 网络监听与 websocket 握手属于集成测试范围，这里聚焦可直接验证的计数逻辑。
 */

import { describe, expect, it } from "vitest";
import { getStats, trackInboundAccepted, trackInboundDropped, trackRoute } from "../src/transport/server.js";

describe("transport/server stats", () => {
  /**
   * 验证入站统计计数递增。
   */
  it("should count inbound accepted and dropped", () => {
    const before = getStats();
    trackInboundAccepted();
    trackInboundDropped("unit_test_drop");
    const after = getStats();

    expect(after.acceptedMessages).toBe(before.acceptedMessages + 1);
    expect(after.droppedMessages).toBe(before.droppedMessages + 1);
    expect(after.lastError).toContain("unit_test_drop");
  });

  /** 状态端点使用同一统计对象，因此任意外部错误都不能把凭据写入 lastError。 */
  it("should redact credentials from dropped-message diagnostics", () => {
    trackInboundDropped("dispatch failed Authorization: Bearer browser-token");
    const snapshot = getStats();

    expect(snapshot.lastError).not.toContain("browser-token");
    expect(snapshot.lastError).toContain("[REDACTED]");
  });

  /**
   * 验证路由来源计数递增。
   */
  it("should count route source", () => {
    const before = getStats();
    trackRoute("binding");
    trackRoute("standard");
    const after = getStats();

    expect(after.routedByBinding).toBe(before.routedByBinding + 1);
    expect(after.routedByStandard).toBe(before.routedByStandard + 1);
  });
});
