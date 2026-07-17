import { describe, expect, it, vi } from "vitest";

import { resolveGotifyAccount } from "../src/config.js";
import { GotifyWebSocketError } from "../src/shared/errors.js";
import {
  computeReconnectDelay,
  createGotifyWsListener,
} from "../src/transport/ws-listener.js";

class FakeWebSocket {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: { message?: string }) => void) | null = null;
  public onclose:
    | ((event?: { wasClean?: boolean; reason?: string }) => void)
    | null = null;
  public static instances: FakeWebSocket[] = [];
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.onclose?.({ wasClean: true, reason: "stopped" });
  }
}

function makeAccount(overrides: { maxReconnectAttempts?: number } = {}) {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: "https://push.example.com",
          appToken: "app-token",
          clientToken: "client-token",
          inbound: {
            enabled: true,
            reconnectDelayMs: 10,
            maxReconnectDelayMs: 20,
            maxReconnectAttempts: overrides.maxReconnectAttempts ?? 10,
          },
        },
      },
    },
    "default",
  );
}

describe("ws-listener", () => {
  it("connects and forwards parsed messages", async () => {
    FakeWebSocket.instances = [];
    const account = makeAccount();
    const onMessage = vi.fn();

    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage,
    });

    const startPromise = listener.start();
    const instance = FakeWebSocket.instances[0];
    instance.onopen?.();
    await startPromise;
    await instance.onmessage?.({
      data: JSON.stringify({ id: 1, message: "hello" }),
    });

    expect(instance.url).toContain("/stream?token=client-token");
    expect(onMessage).toHaveBeenCalledWith({ id: 1, message: "hello" });
    listener.stop();
  });

  it("rejects start() when connection closes before open", async () => {
    FakeWebSocket.instances = [];
    const account = makeAccount();
    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
      connectionTimeoutMs: 5_000,
    });

    const startPromise = listener.start();
    const instance = FakeWebSocket.instances[0];
    instance.onclose?.({ wasClean: false, reason: "connection refused" });

    await expect(startPromise).rejects.toBeInstanceOf(GotifyWebSocketError);
    listener.stop();
  });

  it("handles socket errors when the Node runtime has no browser ErrorEvent global", async () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("ErrorEvent", undefined);
    const listener = createGotifyWsListener(makeAccount(), {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
    });
    const startPromise = listener.start();
    expect(() =>
      FakeWebSocket.instances[0].onerror?.({ message: "refused" }),
    ).not.toThrow();
    await expect(startPromise).rejects.toBeInstanceOf(GotifyWebSocketError);
    listener.stop();
    vi.unstubAllGlobals();
  });

  it("does not throw uncaught when reconnect attempts are exhausted", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const account = makeAccount({ maxReconnectAttempts: 0 });
    const onStateChange = vi.fn();

    const listener = createGotifyWsListener(account, {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
      onStateChange,
      connectionTimeoutMs: 5_000,
    });

    const startPromise = listener.start();
    const first = FakeWebSocket.instances[0];
    first.onopen?.();
    await startPromise;

    first.onclose?.({ wasClean: false, reason: "dropped" });

    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();

    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        running: false,
        lastError: expect.stringContaining("reconnect attempts exhausted"),
      }),
    );

    listener.stop();
    vi.useRealTimers();
  });

  it("coalesces concurrent start calls into one socket", async () => {
    FakeWebSocket.instances = [];
    const listener = createGotifyWsListener(makeAccount(), {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
    });

    const firstStart = listener.start();
    const secondStart = listener.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].onopen?.();
    await Promise.all([firstStart, secondStart]);
    await listener.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    listener.stop();
  });

  it("does not leave a ghost reconnect loop when the initial connection fails", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const listener = createGotifyWsListener(makeAccount(), {
      WebSocketImpl: FakeWebSocket as never,
      onMessage: vi.fn(),
    });

    const startPromise = listener.start();
    FakeWebSocket.instances[0].onclose?.({
      wasClean: false,
      reason: "refused",
    });
    await expect(startPromise).rejects.toBeInstanceOf(GotifyWebSocketError);
    await vi.runAllTimersAsync();

    expect(FakeWebSocket.instances).toHaveLength(1);
    listener.stop();
    vi.useRealTimers();
  });

  it("computes deterministic symmetric reconnect jitter", () => {
    expect(computeReconnectDelay(1000, 0.2, () => 0)).toBe(800);
    expect(computeReconnectDelay(1000, 0.2, () => 0.5)).toBe(1000);
    expect(computeReconnectDelay(1000, 0.2, () => 1)).toBe(1200);
  });
});
