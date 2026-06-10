/**
 * Web STOMP ACK/NACK handler 单元测试。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  cleanupConnection,
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

  it("confirms batch in client mode", () => {
    const id1 = registerMessage("sub-1", "conn-a", "/topic/a", "client");
    registerMessage("sub-1", "conn-a", "/topic/a", "client");
    expect(handleAck(id1)).toBe(2);
  });

  it("returns 0 for unknown message id", () => {
    expect(handleAck("missing")).toBe(0);
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
});
