/**
 * Web STOMP subscription manager 单元测试。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  addSubscription,
  getConnectionSubscriptions,
  getSubscribers,
  getSubscriptionStats,
  removeAllSubscriptions,
  removeSubscription,
} from "../src/transport/subscription-mgr.js";

describe("subscription manager", () => {
  beforeEach(() => {
    removeAllSubscriptions("conn-1");
    removeAllSubscriptions("conn-2");
  });

  it("adds and indexes subscriptions by destination", () => {
    addSubscription("conn-1", {
      id: "sub-1",
      destination: "/topic/chat",
      ackMode: "auto",
    });

    const subs = getSubscribers("/topic/chat");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      connectionId: "conn-1",
      id: "sub-1",
      destination: "/topic/chat",
    });
  });

  it("lists subscriptions for a connection", () => {
    addSubscription("conn-1", { id: "sub-a", destination: "/topic/a", ackMode: "auto" });
    addSubscription("conn-1", { id: "sub-b", destination: "/topic/b", ackMode: "auto" });

    expect(getConnectionSubscriptions("conn-1")).toHaveLength(2);
  });

  it("removes a single subscription", () => {
    addSubscription("conn-1", { id: "sub-rm", destination: "/topic/rm", ackMode: "auto" });
    removeSubscription("conn-1", "sub-rm");
    expect(getSubscribers("/topic/rm")).toHaveLength(0);
  });

  it("removeAllSubscriptions clears connection subscriptions", () => {
    addSubscription("conn-2", { id: "sub-x", destination: "/topic/x", ackMode: "auto" });
    removeAllSubscriptions("conn-2");
    expect(getConnectionSubscriptions("conn-2")).toHaveLength(0);
    expect(getSubscriptionStats().totalSubscriptions).toBe(0);
  });

  it("tracks aggregate stats", () => {
    addSubscription("conn-1", { id: "sub-1", destination: "/topic/one", ackMode: "auto" });
    addSubscription("conn-2", { id: "sub-2", destination: "/topic/two", ackMode: "auto" });

    const stats = getSubscriptionStats();
    expect(stats.totalSubscriptions).toBe(2);
    expect(stats.uniqueDestinations).toBe(2);
    expect(stats.activeConnections).toBe(2);
  });
});
