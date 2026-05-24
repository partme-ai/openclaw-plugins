/**
 * STOMP 插件入口与 runtime 冒烟测试。
 */
import { describe, expect, it } from "vitest";

import { stompTcpChannelFixture } from "../../../test-utils/channel-fixtures.js";
import { resolveStompTcpConfig } from "../src/config.js";
import { clearStompRuntime, getStompRuntime, setStompRuntime } from "../src/runtime.js";

describe("openclaw-stomp plugin entry", () => {
  it("resolveStompTcpConfig accepts shared fixture", () => {
    const cfg = resolveStompTcpConfig(stompTcpChannelFixture());
    expect(cfg.port).toBe(61673);
    expect(cfg.topicBindings).toHaveLength(1);
  });
});

describe("stomp runtime", () => {
  it("setStompRuntime and getStompRuntime round-trip", () => {
    clearStompRuntime();
    const mock = { config: {}, channel: {} };
    setStompRuntime(mock);
    expect(getStompRuntime()).toBe(mock);
    clearStompRuntime();
  });

  it("getStompRuntime throws when unset", () => {
    clearStompRuntime();
    expect(() => getStompRuntime()).toThrow(/runtime is not initialized/);
  });
});
