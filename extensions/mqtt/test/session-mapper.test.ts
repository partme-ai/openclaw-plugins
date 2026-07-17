/**
 * MQTT 会话映射与生命周期回归测试。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureSessionExpiry,
  getClientIdBySession,
  getSessionContext,
  getSessionStats,
  handleClientDisconnected,
  markClientConnected,
  resetSessionMappings,
  upsertSessionContext,
} from "../src/routing/session-mapper.js";

const SESSION_KEY = "agent:iot:mqtt:default:direct:device-1";

function addSession(): void {
  upsertSessionContext(SESSION_KEY, {
    clientId: "device-1",
    agentId: "iot",
    accountId: "default",
    lastInboundTopic: "devices/device-1/in",
    replyTopic: "devices/device-1/out",
  });
}

describe("MQTT session mapper lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSessionMappings();
  });

  afterEach(() => {
    resetSessionMappings();
    vi.useRealTimers();
  });

  it("stores both client and route context", () => {
    addSession();
    expect(getClientIdBySession(SESSION_KEY)).toBe("device-1");
    expect(getSessionContext(SESSION_KEY)).toMatchObject({
      agentId: "iot",
      accountId: "default",
      replyTopic: "devices/device-1/out",
    });
    expect(getSessionStats()).toMatchObject({
      activeSessions: 1,
      uniqueClients: 1,
      contextBoundSessions: 1,
    });
  });

  it("removes sessions immediately when reconnect persistence is disabled", () => {
    addSession();
    configureSessionExpiry(60, false);
    handleClientDisconnected("device-1");
    expect(getClientIdBySession(SESSION_KEY)).toBeNull();
    expect(getSessionStats().pendingExpiryClients).toBe(0);
  });

  it("keeps a session during the reconnect window and expires it afterwards", () => {
    addSession();
    configureSessionExpiry(30, true);
    handleClientDisconnected("device-1");
    expect(getClientIdBySession(SESSION_KEY)).toBe("device-1");
    expect(getSessionStats()).toMatchObject({
      pendingExpiryClients: 1,
      delayedExpiryCount: 1,
    });

    vi.advanceTimersByTime(29_999);
    expect(getClientIdBySession(SESSION_KEY)).toBe("device-1");
    vi.advanceTimersByTime(1);
    expect(getClientIdBySession(SESSION_KEY)).toBeNull();
    expect(getSessionStats().pendingExpiryClients).toBe(0);
  });

  it("cancels delayed expiry when the same client reconnects", () => {
    addSession();
    configureSessionExpiry(30, true);
    handleClientDisconnected("device-1");
    markClientConnected("device-1");
    vi.advanceTimersByTime(30_000);
    expect(getClientIdBySession(SESSION_KEY)).toBe("device-1");
    expect(getSessionStats().pendingExpiryClients).toBe(0);
  });

  it("clears stale routes and timers on Gateway stop/reload", () => {
    addSession();
    configureSessionExpiry(86_400, true);
    handleClientDisconnected("device-1");
    resetSessionMappings();
    expect(getClientIdBySession(SESSION_KEY)).toBeNull();
    expect(getSessionContext(SESSION_KEY)).toBeNull();
    expect(getSessionStats()).toEqual({
      activeSessions: 0,
      uniqueClients: 0,
      contextBoundSessions: 0,
      pendingExpiryClients: 0,
      delayedExpiryCount: 0,
    });
  });
});
