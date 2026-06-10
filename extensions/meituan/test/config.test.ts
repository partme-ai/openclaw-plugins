/**
 * Meituan config getter and resolver tests.
 */
import { describe, expect, it } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createMeituanConfigGetter } from "../src/config.js";
import {
  resolveMeituanAgentReplyTimeoutMs,
  resolveMeituanEgressProxyUrl,
  resolveMeituanMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("createMeituanConfigGetter", () => {
  it("returns empty object when channels.meituan missing", () => {
    const api = createMockPluginApi({ config: { channels: {} } });
    expect(createMeituanConfigGetter(api as never)()).toEqual({});
  });

  it("reads channels.meituan from runtime config", () => {
    const api = createMockPluginApi({
      config: {
        channels: {
          meituan: { app_key: "mk", app_secret: "ms", shop_id: "s1" },
        },
      },
    });
    expect(createMeituanConfigGetter(api as never)()).toEqual({
      app_key: "mk",
      app_secret: "ms",
      shop_id: "s1",
    });
  });

  it("shallow-merges pluginConfig over channels.meituan", () => {
    const api = createMockPluginApi({
      config: { channels: { meituan: { app_key: "base", app_secret: "sec" } } },
      pluginConfig: { shop_id: "overlay-shop", webhook_secret: "wh-sec" },
    });
    expect(createMeituanConfigGetter(api as never)()).toEqual({
      app_key: "base",
      app_secret: "sec",
      shop_id: "overlay-shop",
      webhook_secret: "wh-sec",
    });
  });
});

describe("meituan config resolvers", () => {
  it("uses 20MB default media max bytes", () => {
    expect(resolveMeituanMediaMaxBytes({ channels: {} })).toBe(20 * 1024 * 1024);
  });

  it("honours channels.meituan.media.maxBytes override", () => {
    expect(
      resolveMeituanMediaMaxBytes({ channels: { meituan: { media: { maxBytes: 1024 } } } }),
    ).toBe(1024);
  });

  it("uses 10 minute default agent reply timeout", () => {
    expect(resolveMeituanAgentReplyTimeoutMs({ channels: {} })).toBe(10 * 60 * 1000);
  });

  it("reads channels.meituan.network.egressProxyUrl", () => {
    expect(
      resolveMeituanEgressProxyUrl({
        channels: { meituan: { network: { egressProxyUrl: "http://proxy" } } },
      }),
    ).toBe("http://proxy");
  });
});
