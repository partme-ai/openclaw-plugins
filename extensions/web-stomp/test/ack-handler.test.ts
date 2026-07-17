/**
 * Web STOMP ACK/NACK handler 单元测试。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanupConnection,
  cleanupSubscription,
  discardPendingMessage,
  getAckStats,
  handleAck,
  handleNack,
  registerMessage,
} from "../src/transport/ack-handler.js";

const ALL_CONN_IDS = ["conn-1", "conn-a", "conn-b", "conn-nack", "conn-clean", "conn-other", "conn-reset"];

function resetAckState(): void {
  for (const conn of ALL_CONN_IDS) {
    cleanupConnection(conn);
  }
}

describe("registerMessage", () => {
  beforeEach(() => {
    resetAckState();
  });

  it("returns message id without tracking in auto mode", () => {
    const id = registerMessage("sub-1", "conn-1", "/topic/a", "auto");
    expect(id).toMatch(/^msg-/);
    expect(getAckStats().pendingCount).toBe(0);
  });

  it("tracks pending messages for client-individual mode", () => {
    registerMessage("sub-1", "conn-1", "/topic/a", "client-individual");
    expect(getAckStats().pendingCount).toBe(1);
  });

  it("discards a pending entry when WebSocket delivery fails", () => {
    const id = registerMessage("sub-1", "conn-1", "/topic/a", "client-individual");
    discardPendingMessage(id);
    expect(getAckStats().pendingCount).toBe(0);
  });
});

describe("handleAck", () => {
  beforeEach(() => {
    resetAckState();
  });

  it("confirms single message in client-individual mode", () => {
    const id = registerMessage("sub-1", "conn-a", "/topic/a", "client-individual");
    expect(handleAck(id)).toBe(1);
    expect(getAckStats().pendingCount).toBe(0);
  });

  it("client 模式只累计确认目标消息及之前消息，不误确认之后消息", () => {
    const id1 = registerMessage("sub-1", "conn-a", "/topic/a", "client");
    const id2 = registerMessage("sub-1", "conn-a", "/topic/a", "client");
    expect(handleAck(id1)).toBe(1);
    expect(getAckStats().pendingCount).toBe(1);
    expect(handleAck(id2)).toBe(1);
  });

  it("同一毫秒投递也按单调序号累计 ACK", () => {
    const now = Date.now;
    Date.now = () => 1_000;
    try {
      registerMessage("sub-1", "conn-a", "/topic/a", "client");
      const id2 = registerMessage("sub-1", "conn-a", "/topic/a", "client");
      registerMessage("sub-1", "conn-a", "/topic/a", "client");
      expect(handleAck(id2)).toBe(2);
      expect(getAckStats().pendingCount).toBe(1);
    } finally {
      Date.now = now;
    }
  });

  it("returns 0 for unknown message id", () => {
    expect(handleAck("missing")).toBe(0);
  });

  it("does not allow another connection to ACK a delivery", () => {
    const id = registerMessage("sub-1", "conn-a", "/topic/a", "client-individual");
    expect(handleAck(id, "conn-b")).toBe(0);
    expect(getAckStats().pendingCount).toBe(1);
    expect(handleAck(id, "conn-a")).toBe(1);
  });
});

describe("handleNack", () => {
  beforeEach(() => {
    resetAckState();
  });

  it("returns metadata and removes pending entry", () => {
    const id = registerMessage("sub-n", "conn-nack", "/topic/nack", "client-individual");
    const meta = handleNack(id);
    expect(meta).toMatchObject({
      subscriptionId: "sub-n",
      connectionId: "conn-nack",
      destination: "/topic/nack",
    });
    expect(getAckStats().pendingCount).toBe(0);
  });

  it("returns null for unknown id", () => {
    expect(handleNack("unknown")).toBeNull();
  });

  it("client 模式累计 NACK 目标消息及之前消息", () => {
    registerMessage("sub-n", "conn-nack", "/topic/nack", "client");
    const second = registerMessage("sub-n", "conn-nack", "/topic/nack", "client");
    registerMessage("sub-n", "conn-nack", "/topic/nack", "client");

    expect(handleNack(second, "conn-nack")).not.toBeNull();
    expect(getAckStats().pendingCount).toBe(1);
  });
});

describe("cleanupConnection", () => {
  beforeEach(() => {
    resetAckState();
  });

  it("removes all pending messages for a connection", () => {
    registerMessage("sub-x", "conn-clean", "/topic/x", "client-individual");
    registerMessage("sub-y", "conn-clean", "/topic/y", "client-individual");
    registerMessage("sub-z", "conn-other", "/topic/z", "client-individual");

    cleanupConnection("conn-clean");
    expect(getAckStats().pendingCount).toBe(1);
  });

  it("取消订阅只释放该订阅的 pending ACK", () => {
    registerMessage("sub-x", "conn-clean", "/topic/x", "client-individual");
    registerMessage("sub-y", "conn-clean", "/topic/y", "client-individual");

    cleanupSubscription("conn-clean", "sub-x");
    expect(getAckStats().pendingCount).toBe(1);
  });
});
