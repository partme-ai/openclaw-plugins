/** Redis 连接安全边界与重连退避测试。 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REDIS_CHANNEL_CONFIG,
  safeParseRedisStreamConfig,
} from "../src/config.js";
import {
  computeRedisReconnectDelay,
  createPubSubDispatcher,
} from "../src/transport/server.js";

describe("Redis connection hardening", () => {
  it("requires rediss for remote Redis unless plaintext is explicitly allowed", () => {
    expect(
      safeParseRedisStreamConfig({
        ...DEFAULT_REDIS_CHANNEL_CONFIG,
        url: "redis://redis.example.com:6379",
      }).success,
    ).toBe(false);

    expect(
      safeParseRedisStreamConfig({
        ...DEFAULT_REDIS_CHANNEL_CONFIG,
        url: "redis://redis.example.com:6379",
        connection: {
          ...DEFAULT_REDIS_CHANNEL_CONFIG.connection,
          allowInsecureRemote: true,
        },
      }).success,
    ).toBe(true);
  });

  it("computes bounded exponential delay with deterministic jitter", () => {
    expect(
      computeRedisReconnectDelay(DEFAULT_REDIS_CHANNEL_CONFIG, 0, () => 0.5),
    ).toBe(3000);
    expect(
      computeRedisReconnectDelay(DEFAULT_REDIS_CHANNEL_CONFIG, 10, () => 0.5),
    ).toBe(30000);
    expect(
      computeRedisReconnectDelay(DEFAULT_REDIS_CHANNEL_CONFIG, 0, () => 0),
    ).toBe(2400);
    expect(
      computeRedisReconnectDelay(DEFAULT_REDIS_CHANNEL_CONFIG, 0, () => 1),
    ).toBe(3600);
  });

  it("bounds concurrent Pub/Sub dispatches instead of growing without limit", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handler = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstPending;
        return true;
      })
      .mockResolvedValue(true);
    const dispatch = createPubSubDispatcher(
      {
        ...DEFAULT_REDIS_CHANNEL_CONFIG,
        connection: {
          ...DEFAULT_REDIS_CHANNEL_CONFIG.connection,
          maxPubSubInFlight: 1,
        },
      },
      handler,
    );

    expect(dispatch({ channel: "events", message: "first" })).toBe(true);
    expect(dispatch({ channel: "events", message: "overload" })).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    releaseFirst();
    await handler.mock.results[0]?.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatch({ channel: "events", message: "after-release" })).toBe(
      true,
    );
  });
});
