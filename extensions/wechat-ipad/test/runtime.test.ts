/**
 * WeChat iPad runtime cache tests.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  getResolvedWechatIpadConfig,
  getWechatIpadRuntime,
  setResolvedWechatIpadConfig,
  setWechatIpadRuntime,
} from "../src/runtime.js";
import { DEFAULT_CONFIG } from "../src/types.js";

describe("wechat-ipad runtime cache", () => {
  beforeEach(() => {
    setWechatIpadRuntime(null as never);
    setResolvedWechatIpadConfig(null as never);
  });

  it("returns null before runtime injection", () => {
    expect(getWechatIpadRuntime()).toBeNull();
    expect(getResolvedWechatIpadConfig()).toBeNull();
  });

  it("stores and retrieves runtime reference", () => {
    const runtime = { config: { channels: {} } } as never;
    setWechatIpadRuntime(runtime);
    expect(getWechatIpadRuntime()).toBe(runtime);
  });

  it("stores and retrieves resolved config", () => {
    const cfg = { ...DEFAULT_CONFIG, serviceUrl: "ws://test" };
    setResolvedWechatIpadConfig(cfg);
    expect(getResolvedWechatIpadConfig()?.serviceUrl).toBe("ws://test");
  });
});
